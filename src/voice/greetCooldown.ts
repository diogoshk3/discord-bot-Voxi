// src/voice/greetCooldown.ts — cooldown da saudação de entrada na call (plano 017).
//
// PROBLEMA: sem cooldown, quem spama ENTRAR/SAIR do canal do bot faz o Vozen dizer
// "Olá {nome}" (ou os parabéns) sem parar — chato e ruidoso. SOLUÇÃO: por (guild,
// user), só saúda uma vez a cada GREET_COOLDOWN_MS. É uma JANELA FIXA: um pedido
// suprimido NÃO estende a janela (senão um spammer contínuo nunca mais era saudado),
// por isso o timestamp só é renovado quando a saudação REALMENTE sai.
//
// Estado em memória (não persiste; reset no restart é aceitável). Cap + evict da
// entrada mais antiga (anti-crescimento), mesmo padrão do langMemory.

/** Janela do cooldown: 5 minutos. Constante — não é configurável (decisão do Diogo). */
export const GREET_COOLDOWN_MS = 5 * 60 * 1000;
/** Teto de entradas (anti-crescimento); evict da mais antiga ao exceder. */
const MAX_ENTRIES = 10_000;

/**
 * Cooldown por (guild, user) da saudação de entrada. Relógio injetável para testes.
 * Uma instância partilhada vive no BotDeps (como o lastSpeaker).
 */
export class GreetCooldown {
  // Map preserva ordem de inserção → a 1.ª chave é a mais antiga (evict simples).
  private readonly last = new Map<string, number>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  private static keyOf(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
  }

  /**
   * A saudação a (guild, user) deve sair AGORA? True se nunca saudado ou se já
   * passaram ≥ GREET_COOLDOWN_MS desde a última saudação — e nesse caso REGISTA o
   * instante (consome a janela). False dentro da janela, SEM renovar o timestamp
   * (janela fixa: spam de entrar/sair não a estende). Chamar só quando há mesmo uma
   * saudação a dizer (senão gastava a janela à toa).
   */
  shouldGreet(guildId: string, userId: string): boolean {
    const key = GreetCooldown.keyOf(guildId, userId);
    const nowMs = this.now();
    const prev = this.last.get(key);
    if (prev !== undefined && nowMs - prev < GREET_COOLDOWN_MS) return false;
    this.last.delete(key); // reinsere no fim (MRU) para o evict acertar na mais antiga
    this.last.set(key, nowMs);
    if (this.last.size > MAX_ENTRIES) {
      const oldest = this.last.keys().next().value as string | undefined;
      if (oldest !== undefined) this.last.delete(oldest);
    }
    return true;
  }
}
