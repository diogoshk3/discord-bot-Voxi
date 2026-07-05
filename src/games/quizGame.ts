import type { Game, GameContext, GameMessage, SayOpts } from './types';

/**
 * Uma ronda de um jogo-quiz de voz: o que FALAR/ENVIAR e como reconhecer a resposta
 * certa. Todos os textos ja vem LOCALIZADOS (o jogo chama ctx.t antes de os por aqui).
 */
export interface QuizRound {
  /** Fala em voz alta (opcional): o "enigma" da ronda. */
  speak?: { text: string; opts?: SayOpts };
  /** Mensagem a enviar ao canal ao abrir a ronda (ex. "Ronda 2/5 — ouve…"). */
  announce?: string;
  /** A resposta `raw` (crua) esta certa? */
  accept: (raw: string) => boolean;
  /** Mensagem de canal quando alguem acerta (recebe o nome de quem acertou). */
  onCorrect: (userName: string) => string;
  /** Mensagem de canal quando a ronda expira sem resposta. */
  onTimeout: () => string;
}

/**
 * Base PARTILHADA dos jogos "voz -> primeiro a acertar" (Adivinha a Lingua,
 * Velocidade, Ditado, Matematica, …). Trata de TODA a maquinaria comum:
 *  - loop de N rondas com intro opcional;
 *  - fala/anuncia cada ronda e arma o timeout;
 *  - aceita o PRIMEIRO palpite certo (award 1 ponto), ignora os seguintes na ronda;
 *  - o timeout captura o numero da ronda para nao disparar numa ronda ja avancada
 *    (evita o timer-fantasma sem cancelar o timer — mesmo padrao do guessLanguage);
 *  - placar local + resumo final partilhado (game.finish.*).
 *
 * Cada jogo concreto so implementa o CONTEUDO: prepare (nº de rondas + prep unica),
 * makeRound (a ronda i) e emptyMessage (sem conteudo). Assim um jogo novo fica em
 * ~40 linhas em vez de repetir esta maquinaria.
 */
export abstract class QuizGame implements Game {
  abstract readonly id: string;
  /** Tempo-limite de cada ronda (ms). Sobreponivel por jogo. */
  protected roundMs = 25_000;

  private idx = 0;
  private total = 0;
  private answered = true; // true entre rondas — nao aceita palpites fora de ronda
  private cur: QuizRound | null = null;
  private readonly tally = new Map<string, { name: string; points: number }>();

  /** Prep unica; devolve o nº de rondas. <=0 => sem conteudo (envia emptyMessage). */
  protected abstract prepare(ctx: GameContext): number;
  /** Constroi a ronda `index` (0-based). Chamado uma vez por ronda. */
  protected abstract makeRound(ctx: GameContext, index: number): QuizRound;
  /** Mensagem quando nao ha conteudo para jogar (prepare devolveu 0). */
  protected abstract emptyMessage(ctx: GameContext): string;
  /** Texto de intro (ja localizado). null => sem intro. */
  protected intro(_ctx: GameContext, _rounds: number): string | null {
    return null;
  }

  async start(ctx: GameContext): Promise<void> {
    this.total = this.prepare(ctx);
    if (this.total <= 0) {
      await ctx.send(this.emptyMessage(ctx));
      ctx.end();
      return;
    }
    const intro = this.intro(ctx, this.total);
    if (intro) await ctx.send(intro);
    this.next(ctx);
  }

  private next(ctx: GameContext): void {
    if (this.idx >= this.total) {
      void this.finish(ctx);
      return;
    }
    this.cur = this.makeRound(ctx, this.idx);
    this.idx++;
    this.answered = false;
    const myRound = this.idx;
    if (this.cur.announce) void ctx.send(this.cur.announce);
    if (this.cur.speak) void ctx.say(this.cur.speak.text, this.cur.speak.opts);
    ctx.after(this.roundMs, () => {
      if (this.idx === myRound && !this.answered) this.onTimeout(ctx);
    });
  }

  private onTimeout(ctx: GameContext): void {
    this.answered = true;
    if (this.cur) void ctx.send(this.cur.onTimeout());
    this.next(ctx);
  }

  onMessage(ctx: GameContext, msg: GameMessage): void {
    if (this.answered || !this.cur) return;
    if (!this.cur.accept(msg.content)) return;
    this.answered = true;
    ctx.award(msg.authorId, 1);
    const entry = this.tally.get(msg.authorId) ?? { name: msg.authorName, points: 0 };
    entry.points += 1;
    entry.name = msg.authorName;
    this.tally.set(msg.authorId, entry);
    void ctx.send(this.cur.onCorrect(msg.authorName));
    this.next(ctx);
  }

  private async finish(ctx: GameContext): Promise<void> {
    const ranked = [...this.tally.values()].sort((a, b) => b.points - a.points);
    if (ranked.length === 0) {
      await ctx.send(ctx.t('game.finish.noScores'));
    } else {
      const lines = ranked.map((r, i) =>
        ctx.t('game.finish.line', { rank: i + 1, user: r.name, points: r.points }),
      );
      await ctx.send(`${ctx.t('game.finish.title')}\n${lines.join('\n')}`);
    }
    ctx.end();
  }
}
