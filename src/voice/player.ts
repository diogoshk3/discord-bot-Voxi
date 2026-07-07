import {
  AudioPlayer,
  AudioPlayerStatus,
  AudioResource,
  StreamType,
  VoiceConnection,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
} from '@discordjs/voice';
import type { TTSEngine, SynthRequest } from '../tts/engine';
import { emphasisGain } from '../tts/emphasis';
import { PlayQueue } from './queue';
import { log } from '../logging/logger';
import { metrics } from '../metrics';

// Tempo maximo a esperar que a VoiceConnection fique Ready antes de tocar. Numa
// ligacao lenta / 1a fala a conexao pode estar em signalling/connecting; tocar
// nesse instante manda o audio para o vazio (sem som e sem erro).
const CONNECTION_READY_TIMEOUT_MS = 10_000;

export class GuildVoicePlayer {
  private readonly player: AudioPlayer;
  private readonly queue: PlayQueue;
  private current: AudioResource | null = null;
  private playing = false;
  private destroyed = false;
  // /skip disparado DURANTE a janela de sintese (synth + entersState Ready), quando
  // o AudioPlayer real ainda esta Idle e player.stop() e no-op. Sinaliza que o item
  // in-flight deve ser DESCARTADO antes de tocar. Ver skip()/playNext().
  private pendingSkip = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private reconnecting = false;

  constructor(
    private readonly connection: VoiceConnection,
    private readonly engine: TTSEngine,
    queueCap: number,
    private readonly inactivityMs: number,
    private readonly onIdle: () => void,
  ) {
    this.queue = new PlayQueue(queueCap);
    this.player = createAudioPlayer();
    this.connection.subscribe(this.player);

    this.player.on(AudioPlayerStatus.Idle, () => {
      this.current = null;
      void this.playNext();
    });

    this.player.on('error', (err) => {
      // So loga. NAO drena a fila aqui: no @discordjs/voice um erro de stream do
      // recurso a tocar emite 'error' E DEPOIS transiciona para idle (o setter
      // emite Idle) — sincrono, para o MESMO recurso. Ter playNext() aqui E no
      // Idle drenava a fila 2x (double-fire), colapsando a flag `playing` (quebra
      // single-worker/FIFO) e podendo disparar onIdle() a meio da fala. O Idle
      // faz o unico drain. Tambem NAO se poe current=null aqui: num erro de
      // recurso ja substituido (stale) nao ha Idle a seguir (guard resource ===
      // this.state.resource no onStreamError), logo current aponta para o recurso
      // NOVO e anula-lo aqui quebraria a reproducao; o reset de current fica so no
      // Idle, que so ocorre para o recurso corrente.
      log.error('[player] erro no AudioPlayer:', err);
    });

    this.connection.on(VoiceConnectionStatus.Disconnected, () => {
      void this.handleDisconnect();
    });

    this.armIdleTimer();
  }

  async say(req: SynthRequest): Promise<boolean> {
    // Devolve o RESULTADO SINCRONO de enfileirar: true se o pedido entrou na fila,
    // false se foi descartado (player destruido OU fila no cap). Os comandos
    // explicitos (/tts, /voice preview) usam este boolean para nao mentir "queued"
    // quando NADA entrou na fila. NB: so o sinal SINCRONO de fila-cheia — synth-skip
    // / ligacao-nao-Ready acontecem DEPOIS no worker (playNext), portanto NAO se
    // refletem aqui (por design; ver comentarios em playNext).
    if (this.destroyed) return false;
    // Enfileira SINCRONAMENTE por ordem de chegada (preserva FIFO da spec §7).
    // A sintese acontece no worker (playNext), nao aqui, para nao reordenar
    // pedidos concorrentes pela duracao/cache-hit da sintese.
    const ok = this.queue.enqueue({ req });
    if (!ok) {
      log.warn('[player] fila cheia, pedido descartado');
      return false;
    }
    if (!this.playing) {
      void this.playNext();
    }
    return true;
  }

  // Predicado LEVE: ha algo a decorrer? Esta a tocar (playing) OU tem itens na
  // fila. O /skip le isto ANTES de skip() para distinguir "nada a tocar" de
  // "saltei" — em vez de fingir sempre que saltou. NAO altera estado.
  isActive(): boolean {
    return this.playing || this.queue.size() > 0;
  }

  skip(): void {
    if (this.destroyed) return;
    // Caso normal (a tocar): stop() emite Idle -> o handler chama playNext() e
    // avanca para o proximo item.
    //
    // Caso da JANELA DE SINTESE: quando o /skip chega durante synth()/entersState
    // (playing=true mas play() ainda nao correu), o AudioPlayer REAL esta Idle e
    // stop() e no-op (no @discordjs/voice, stop() faz `if (idle) return false` —
    // nao emite Idle). O skip seria PERDIDO e a fala tocava na integra. Detetamos
    // isso: so esta REALMENTE a tocar se o estado do player e Playing ou Buffering.
    // Se nao esta -> estamos na janela -> marcamos pendingSkip para que playNext()
    // descarte o item in-flight antes de o tocar.
    const wasPlaying =
      this.player.state.status === AudioPlayerStatus.Playing ||
      this.player.state.status === AudioPlayerStatus.Buffering;
    this.player.stop(true);
    if (!wasPlaying) {
      this.pendingSkip = true;
    }
  }

  /**
   * "Cala-te já": esvazia a fila TODA e pára o que está a tocar, mas FICA na call
   * (ao contrário de destroy(), que sai). O /shutup usa isto. Depois do stop(), o
   * player emite Idle -> playNext() encontra a fila vazia -> fica em repouso. Trata a
   * mesma janela de síntese do skip(): se o AudioPlayer real ainda está Idle (a fala
   * está a ser sintetizada), stop() é no-op, por isso marcamos pendingSkip para o
   * item in-flight ser descartado em vez de tocar.
   */
  silence(): void {
    if (this.destroyed) return;
    this.queue.clear();
    const wasPlaying =
      this.player.state.status === AudioPlayerStatus.Playing ||
      this.player.state.status === AudioPlayerStatus.Buffering;
    this.player.stop(true);
    if (!wasPlaying) this.pendingSkip = true;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearIdleTimer();
    this.queue.clear();
    this.current = null;
    this.playing = false;
    try {
      this.player.stop(true);
    } catch {
      // ignorar
    }
    try {
      this.connection.destroy();
    } catch {
      // ja pode estar destruida
    }
  }

  private async playNext(): Promise<void> {
    if (this.destroyed) return;
    const next = this.queue.dequeue();
    if (!next) {
      this.playing = false;
      this.armIdleTimer();
      return;
    }
    this.clearIdleTimer();
    // RESET do pendingSkip no INICIO de cada iteracao (logo apos o dequeue, ANTES
    // dos awaits). Garante que um /skip so afeta o item ATUAL e nunca vaza para o
    // seguinte: se a janela de sintese de B foi saltada (ou a sintese de B falhou e
    // drenou C), a iteracao de C limpa a flag e C toca normalmente. INVARIANTE
    // anti-leak.
    this.pendingSkip = false;
    // IMPORTANTE: marcar `playing` ANTES do await da sintese. Isto impede que um
    // `say()` concorrente (que ve `!this.playing`) arranque um segundo worker de
    // drain durante a sintese, o que quebraria a ordem FIFO.
    this.playing = true;

    let audioPath: string;
    const synthStart = process.hrtime.bigint();
    try {
      audioPath = await this.engine.synth(next.req);
      // Latencia de sintese efetiva (inclui cache hit rapido e miss/spawn lento).
      metrics.recordSynthMs(Number(process.hrtime.bigint() - synthStart) / 1e6);
    } catch (err) {
      log.error('[player] erro na sintese, item saltado:', err);
      metrics.inc('synthErrors');
      // Salta este item e continua a fila sem crashar (sem crescimento de stack:
      // estamos depois do await).
      void this.playNext();
      return;
    }

    // A sintese pode ter demorado; o player pode ter sido destruido entretanto.
    if (this.destroyed) return;

    // Garantir que a ligacao esta Ready ANTES de tocar. Se estiver em
    // signalling/connecting (ligacao lenta / 1a fala), tocar agora mandaria o
    // audio para o vazio. entersState resolve logo se ja estiver Ready. Feito
    // DEPOIS da sintese de proposito: a ligacao estabelece EM PARALELO com a
    // sintese, portanto esperar aqui aproxima-se de max(ready, synth) em vez de
    // os somar.
    try {
      await entersState(
        this.connection,
        VoiceConnectionStatus.Ready,
        CONNECTION_READY_TIMEOUT_MS,
      );
    } catch (err) {
      // A rejeicao pode ter sido causada por destroy() (que destroi a ligacao).
      if (this.destroyed) return;
      log.warn('[player] ligacao de voz nao ficou Ready, fala saltada:', err);
      // Mesmo tratamento do skip de sintese: nao tocamos para o vazio; saltamos
      // este item e continuamos a fila (sem crescimento de stack — estamos
      // depois de um await; sem loop apertado — cada iteracao e gated pelo
      // timeout). Preserva o single-worker de drain e o FIFO.
      void this.playNext();
      return;
    }

    // entersState e mais um await; re-verificar destroyed antes de tocar.
    if (this.destroyed) return;

    // /skip disparado DURANTE a sintese/entersState deste item (janela em que o
    // AudioPlayer estava Idle e stop() foi no-op): descartar o item in-flight SEM
    // tocar e drenar o proximo. Feito ANTES de createAudioResource/messagesSpoken
    // para que um item saltado nunca conte como falado. O pendingSkip foi setado por
    // skip() e sera reposto a false no inicio da proxima iteracao (anti-leak).
    if (this.pendingSkip) {
      this.pendingSkip = false;
      this.current = null;
      void this.playNext();
      return;
    }

    // TAIL guardado: createAudioResource()/play() podem lançar SINCRONAMENTE (ex.:
    // transcoder/prism a falhar). Sem este try/catch, um throw aqui deixava
    // `playing=true` PARA SEMPRE (o worker nunca reposto -> guild muda até
    // reiniciar) e rejeitava o `void playNext()` do call-site (unhandledRejection).
    // Tratamento idêntico ao erro de síntese: salta o item e continua a fila.
    try {
      // ÊNFASE: "mais alto quando há ! ou MAIÚSCULAS". Ganho calculado do texto
      // ORIGINAL (req.text ainda tem as maiúsculas; o deCapsForGoogle só baixa dentro
      // do gTTS). inlineVolume só quando há ganho, para não pagar o VolumeTransformer
      // na esmagadora maioria das falas (ganho 1.0 = sem transformer, caminho normal).
      const gain = emphasisGain(next.req.text);
      const resource = createAudioResource(audioPath, {
        inputType: StreamType.Arbitrary,
        inlineVolume: gain !== 1,
      });
      if (gain !== 1) resource.volume?.setVolume(gain);
      this.current = resource;
      // play() PRIMEIRO: se lançar sincronamente (transcoder/prism a falhar), o catch
      // conta synthErrors — e NÃO queremos contar essa mensagem como "falada". Por isso
      // messagesSpoken incrementa SÓ DEPOIS de play() ter sido chamado com sucesso (o
      // áudio começou a tocar), senão uma falha contava 2× (messagesSpoken + synthErrors).
      this.player.play(resource);
      metrics.inc('messagesSpoken');
    } catch (err) {
      log.error('[player] erro ao criar/tocar o recurso, item saltado:', err);
      metrics.inc('synthErrors');
      this.current = null;
      // Sem crescimento de stack (estamos depois de awaits); repõe o worker via
      // a próxima iteração, que fará playing=false se a fila esvaziar.
      void this.playNext();
    }
  }

  private armIdleTimer(): void {
    // SAÍDA-POR-INATIVIDADE REMOVIDA: o Vozen já NÃO sai só porque não há TTS. A única
    // saída discricionária é "sozinho na call 5 min" (ver AloneWatcher, fora do
    // player). Este método é agora um NO-OP — mantido (com os call-sites) para não
    // remexer no lifecycle; `onIdle` continua a ser usado no caminho de
    // desistência-de-reconexão (handleDisconnect), que NÃO é discricionário.
    // `inactivityMs`/`idleTimer` ficam sem uso funcional (inofensivos).
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private async handleDisconnect(): Promise<void> {
    if (this.destroyed || this.reconnecting) return;
    this.reconnecting = true;
    // Semantica das metricas de voz (P7.4):
    //  - voiceDrops: conta a QUEDA uma vez por episodio. O guard acima
    //    (destroyed || reconnecting) impede que eventos Disconnected repetidos
    //    durante o mesmo episodio de reconexao re-entrem e contem a dobrar.
    //  - voiceReconnects: conta o SUCESSO uma vez, quando a ligacao confirma
    //    estar de volta a Ready — seja pela recuperacao "soft" (entersState Ready
    //    resolve) seja por rejoin manual bem-sucedido (tryRejoin devolve true).
    //    Como tryRejoin devolve um unico booleano (resultado do loop de backoff),
    //    o sucesso conta no RESULTADO, nunca por tentativa — um ciclo de backoff
    //    nunca conta a dobrar. Episodio que falha de vez: drops +1, reconnects +0.
    metrics.inc('voiceDrops');
    try {
      // Reconexao "soft": o gateway esta a renegociar a sessao de voz.
      await Promise.race([
        entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      // Recuperou — esperar que volte a Ready.
      await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
      metrics.inc('voiceReconnects');
    } catch {
      // Nao recuperou via soft — tentar rejoin manual algumas vezes.
      const recovered = await this.tryRejoin(3);
      if (!recovered) {
        // Se ja fomos destruidos EXTERNAMENTE durante a janela de rejoin (ex.:
        // removePlayer via /join ou /leave, que substitui este player por um novo
        // no mesmo slot da guild), NAO chamar destroy()/onIdle(): o onIdle e keyed
        // por guild e derrubaria o SUBSTITUTO + mataria a sessao acabada de criar.
        // Sair em silencio — o novo player e que manda agora. Guard ANTES de
        // destroy() (destroy() poe destroyed=true; um guard a seguir romperia
        // sempre a desistencia legitima). tryRejoin->check->destroy->onIdle e
        // sincrono, logo o /join nao se pode interpor depois deste guard.
        if (this.destroyed) return;
        this.destroy();
        this.onIdle();
        return;
      }
      // Rejoin manual recuperou a ligacao (voltou a Ready) — conta UM sucesso.
      metrics.inc('voiceReconnects');
    } finally {
      this.reconnecting = false;
    }
  }

  private async tryRejoin(attempts: number): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
      if (this.destroyed) return false;
      try {
        this.connection.rejoin();
        await entersState(this.connection, VoiceConnectionStatus.Ready, 10_000);
        return true;
      } catch {
        await new Promise((r) => setTimeout(r, 1_000 * (i + 1)));
      }
    }
    return false;
  }
}
