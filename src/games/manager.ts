import type {
  Game,
  GameContext,
  GameEnv,
  GameMessage,
  Sendable,
  TimerHandle,
} from './types';

/** Estado interno de uma partida ativa (uma por guild). */
interface Session {
  guildId: string;
  channelId: string;
  game: Game;
  timers: Set<TimerHandle>;
  /** Pontos acumulados nesta partida (userId -> pontos), persistidos no fim. */
  points: Map<string, number>;
  ended: boolean;
  seed: number;
  /** O jogo usa a call (jogos de voz) ? Decide se uma SAÍDA DE VOZ o deve terminar. */
  needsVoice: boolean;
  /** Locale do jogo (o de QUEM iniciou) — decide o idioma do texto E do conteúdo. */
  locale: string;
}

/** Mensagem crua que chega ao manager a partir do handler de mensagens. */
export interface IncomingMessage {
  guildId: string;
  channelId: string;
  authorId: string;
  authorName: string;
  content: string;
}

export type StartResult = 'started' | 'already-active';

/**
 * GameManager — o coracao do /game. Garante UM jogo ativo por GUILD (nao por canal):
 * ha uma so ligacao de voz por guild (deps.players e keyed por guildId), e os jogos
 * de voz falam por essa ligacao — dois jogos em canais diferentes da mesma guild
 * baralhariam o audio. Os jogos de tabuleiro (texto puro, futura Vaga 3) poderao
 * relaxar para por-canal, mas o lock base e por-guild.
 *
 * Responsabilidades:
 *  - lock por-guild (start recusa se ja ha jogo);
 *  - encaminhar mensagens do CANAL do jogo para a partida (e sinalizar "consumida"
 *    ao handler, que entao NAO le a mensagem em voz alta);
 *  - possuir os timers da sessao e CANCELA-LOS SEMPRE no fim (o bug classico do
 *    timer-fantasma: o AloneWatcher agora sai imediatamente quando o canal esvazia,
 *    por isso uma partida pode ser abortada a meio — endGuild trata disso);
 *  - persistir os pontos no fim NORMAL (end); descartar no fim FORCADO (stop/endGuild).
 *
 * Nada aqui toca discord.js/SQLite diretamente: tudo passa pelo GameEnv injetado.
 */
export class GameManager {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly env: GameEnv) {}

  /** Ha um jogo ativo nesta guild? */
  active(guildId: string): boolean {
    return this.sessions.has(guildId);
  }

  /** Canal onde decorre o jogo ativo desta guild (null se nao ha jogo). */
  channelOf(guildId: string): string | null {
    return this.sessions.get(guildId)?.channelId ?? null;
  }

  /**
   * Inicia `game` no canal indicado. Devolve 'already-active' se ja houver um jogo
   * nesta guild (o chamador traduz para uma mensagem amigavel). O `game.start` pode
   * ser async; um erro nele e engolido+logado (nunca crasha o comando).
   */
  start(
    guildId: string,
    channelId: string,
    game: Game,
    needsVoice = true,
    locale?: string,
  ): StartResult {
    if (this.sessions.has(guildId)) return 'already-active';
    const session: Session = {
      guildId,
      channelId,
      game,
      timers: new Set(),
      points: new Map(),
      ended: false,
      seed: this.env.clock.now(),
      needsVoice,
      // Locale de quem iniciou (ex.: 'pt'); sem ele cai no locale da guild.
      locale: locale || this.env.localeOf(guildId),
    };
    this.sessions.set(guildId, session);
    const ctx = this.makeContext(session);
    Promise.resolve()
      .then(() => game.start(ctx))
      .catch((err) => this.env.logError(`[game] start ${game.id}`, err));
    return 'started';
  }

  /**
   * Uma mensagem chegou. Devolve TRUE se foi CONSUMIDA — ou seja, ha um jogo ativo NO
   * CANAL dela — caso em que o handler de mensagens NAO a deve ler em voz alta (as
   * respostas dos jogadores nao sao TTS). Mensagens noutros canais da guild (ou sem
   * jogo) devolvem false e seguem o fluxo normal de auto-leitura.
   *
   * O manager NAO deve receber as proprias mensagens do bot (o handler ja as filtra
   * antes de chamar isto), por isso qualquer mensagem que aqui chega no canal certo e
   * um potencial palpite.
   */
  handleMessage(msg: IncomingMessage): boolean {
    const session = this.sessions.get(msg.guildId);
    if (!session || session.ended) return false;
    if (session.channelId !== msg.channelId) return false;
    const ctx = this.makeContext(session);
    const gm: GameMessage = {
      authorId: msg.authorId,
      authorName: msg.authorName,
      content: msg.content,
    };
    Promise.resolve()
      .then(() => session.game.onMessage(ctx, gm))
      .catch((err) => this.env.logError(`[game] onMessage ${session.game.id}`, err));
    return true;
  }

  /**
   * Para o jogo ativo da guild (comando /game stop de um admin). Descarta os pontos
   * acumulados (partida abortada, nao conta). Devolve false se nao havia jogo.
   */
  stop(guildId: string): boolean {
    const s = this.sessions.get(guildId);
    if (!s) return false;
    this.teardown(s, false);
    return true;
  }

  /**
   * O bot SAIU DA CALL desta guild (funil de saida `removePlayer`: /leave, sozinho,
   * desistencia-de-reconexao). So termina o jogo se ELE PRECISAR de voz — um jogo de
   * tabuleiro (texto) nao deve morrer porque a call esvaziou. Para jogos de voz, mata
   * os timers de ronda para nao ficarem a chamar `player.say` num player destruido (o
   * bug timer-fantasma). Nao persiste (partida interrompida).
   */
  onVoiceLeft(guildId: string): void {
    const s = this.sessions.get(guildId);
    if (s && s.needsVoice) this.teardown(s, false);
  }

  /**
   * Teardown FORCADO de QUALQUER jogo ativo: a guild foi removida (kick/leave) ou um
   * shutdown. Chamado do `handleGuildDelete`. Nao persiste — partida interrompida.
   */
  endGuild(guildId: string): void {
    const s = this.sessions.get(guildId);
    if (s) this.teardown(s, false);
  }

  private teardown(s: Session, persist: boolean): void {
    if (s.ended) return;
    s.ended = true;
    for (const h of s.timers) this.env.clock.clearTimeout(h);
    s.timers.clear();
    this.sessions.delete(s.guildId);
    if (persist && s.points.size > 0) {
      try {
        this.env.persistScores(s.guildId, s.points);
      } catch (err) {
        this.env.logError('[game] persistScores', err);
      }
    }
  }

  private makeContext(s: Session): GameContext {
    const env = this.env;
    return {
      guildId: s.guildId,
      channelId: s.channelId,
      locale: s.locale,
      seed: s.seed,
      availableModels: env.availableModels,
      defaultVoice: env.defaultVoiceOf(s.guildId),
      say: async (text: string, opts): Promise<boolean> => {
        const player = env.getPlayer(s.guildId);
        if (!player) return false;
        try {
          return await player.say({
            text,
            model: opts?.model || env.defaultVoiceOf(s.guildId),
            speed: opts?.speed ?? env.defaultSpeed,
            // A lingua/voz de um anuncio de jogo e DELIBERADA — a deteccao nunca deve
            // sobrepor-se (como no /joke, /laugh, /voice preview).
            singleVoice: true,
          });
        } catch (err) {
          env.logError('[game] say', err);
          return false;
        }
      },
      send: async (content: Sendable): Promise<void> => {
        try {
          await env.sendToChannel(s.channelId, content);
        } catch (err) {
          env.logError('[game] send', err);
        }
      },
      t: (key, params) => env.translate(key, s.locale, params),
      after: (ms, fn): void => {
        if (s.ended) return;
        const handle = env.clock.setTimeout(() => {
          s.timers.delete(handle);
          if (s.ended) return;
          try {
            fn();
          } catch (err) {
            env.logError('[game] timer', err);
          }
        }, ms);
        s.timers.add(handle);
      },
      award: (userId, points): void => {
        s.points.set(userId, (s.points.get(userId) ?? 0) + points);
      },
      end: (): void => this.teardown(s, true),
    };
  }
}
