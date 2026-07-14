// src/commands/transcribeGate.ts
//
// Gates PUROS do /transcribe (Fase 4): decidem SEM IO se a transcrição pode arrancar e
// quando deve auto-parar. O handler (integração) traduz o veredito em resposta/ação. Manter
// aqui torna a lógica sensível (authz + entitlement + disponibilidade) testável e sem
// depender do discord.js.

export interface TranscribeStartInput {
  /** Tem a permissão Manage Guild (só admins arrancam a transcrição do servidor). */
  canManage: boolean;
  /** O servidor é Premium (STT é gated a Premium — ver spike: pouca concorrência no VPS). */
  isPremium: boolean;
  /** O sidecar Whisper está instalado nesta instância (resolveWhisperCmd != null). */
  sidecarAvailable: boolean;
  /** O bot está numa call neste servidor (há ligação de voz). */
  botInVoice: boolean;
  /** Já existe uma sessão de transcrição a correr neste servidor. */
  alreadyRunning: boolean;
  /**
   * O cap GLOBAL de sessões STT concorrentes (todas as guilds, processo inteiro) já foi
   * atingido — plano 029/ABUSE-01. Cada sessão arranca um processo Python dedicado com o
   * seu próprio modelo Whisper em RAM (ao contrário do Kokoro, que é um singleton
   * partilhado); sem cap, N guilds Premium a transcrever ao mesmo tempo podem fazer OOM
   * ao processo inteiro (todas as guilds perdem TTS, não só o STT degrada).
   */
  atCapacity: boolean;
}

export type TranscribeStartVerdict =
  'ok' | 'noManage' | 'notPremium' | 'unavailable' | 'notInVoice' | 'alreadyRunning' | 'atCapacity';

/**
 * Ordem dos gates: authz (Manage-Guild) ANTES do entitlement (Premium) — a quem não pode
 * gerir o servidor dizemos "não tens permissão", não "compra Premium". Depois disponibilidade
 * (sidecar), presença na call, sessão já a correr NESTA guild e só por fim o cap GLOBAL
 * (atCapacity). O estado por-guild (alreadyRunning) vem ANTES do global de propósito: é mais
 * específico e mais útil para quem invoca ("já está a correr aqui" > "o sistema está cheio")
 * — e evita mostrar "sistema cheio" a quem só teria de facto "already running".
 */
export function evaluateTranscribeStart(i: TranscribeStartInput): TranscribeStartVerdict {
  if (!i.canManage) return 'noManage';
  if (!i.isPremium) return 'notPremium';
  if (!i.sidecarAvailable) return 'unavailable';
  if (!i.botInVoice) return 'notInVoice';
  if (i.alreadyRunning) return 'alreadyRunning';
  if (i.atCapacity) return 'atCapacity';
  return 'ok';
}

/**
 * Deve a sessão auto-parar? Pára quando a call fica sem HUMANOS, ou — depois de já ter havido
 * pelo menos um consentimento nesta sessão (`everConsented`) — quando não resta ninguém
 * consentido na call. O `everConsented` evita o insta-stop no arranque (antes de alguém
 * carregar no botão, ninguém está consentido, mas isso não é motivo para parar).
 */
export function shouldAutoStop(
  humanIdsInChannel: string[],
  hasConsent: (userId: string) => boolean,
  everConsented: boolean,
): boolean {
  if (humanIdsInChannel.length === 0) return true;
  if (!everConsented) return false;
  return humanIdsInChannel.every((id) => !hasConsent(id));
}

/**
 * Língua a FORÇAR na transcrição: a escolhida no comando (`/transcribe start language:…`)
 * ganha; sem escolha, cai no locale do servidor. Normaliza para minúsculas sem espaços (um
 * código ISO limpo para o sidecar Whisper).
 */
export function resolveTranscribeLang(
  chosen: string | null | undefined,
  guildLocale: string,
): string {
  const c = (chosen ?? '').trim().toLowerCase();
  return c || guildLocale;
}
