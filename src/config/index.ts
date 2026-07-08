import 'dotenv/config';
import { log } from '../logging/logger';
import { PIPER_DEFAULT_SYNTH_PARAMS } from '../tts/calibration';

export type TtsEngineKind = 'piper' | 'neural' | 'gtts' | 'router';

export interface AppConfig {
  token: string;
  clientId: string;
  piperPath: string;
  modelsDir: string;
  dbPath: string;
  defaultVoice: string;
  defaultSpeed: number;
  inactivityMs: number;
  /** Silêncio (ms) PREPENDido a cada mensagem lida — o bot só começa a falar depois. */
  messageLeadMs: number;
  queueCap: number;
  maxChars: number;
  ratePerMin: number;
  ttsEngine: TtsEngineKind;
  openaiApiKey?: string;
  presenceText?: string;
  healthPort?: number;
  shards?: string;
  // P11.5 — webhook top.gg OPCIONAL. Porta ausente => sem servidor (default).
  // Secret ausente => webhook sem auth (inseguro; recomenda-se sempre defini-lo).
  topggWebhookPort?: number;
  topggWebhookSecret?: string;
  // SEC-01 — opt-in EXPLÍCITO para correr o webhook top.gg SEM secret (inseguro:
  // qualquer um que descubra a porta forja votos). Default false => sem secret,
  // o listener NÃO arranca. Env: TOPGG_WEBHOOK_ALLOW_INSECURE=true.
  topggWebhookAllowInsecure: boolean;
  // Vaga 3 — auto-post da contagem de servidores para o top.gg (ranking/descoberta).
  // Token da API do top.gg (TOPGG_TOKEN). Ausente => o updater NAO arranca (opt-in).
  topggToken?: string;
  // Vaga 3 — webhook do Discord para onde enviar erros INESPERADOS (monitorizacao em
  // escala). URL ausente => sem envio (opt-in). Ver src/errorReporter.ts.
  errorWebhookUrl?: string;
  // Sintese multi-lingua por-segmento (default ON). Quando ON, textos com mais do
  // que uma lingua sao sintetizados POR-SEGMENTO (voz certa por lingua) e os WAVs
  // concatenados — o Vozen mistura vozes como uma pessoa real. Pode ser FORCADA a
  // OFF globalmente via env MULTILINGUAL_SEGMENTS=false (voz unica por frase).
  multilingualSegments: boolean;
  // Params de QUALIDADE de sintese do Piper, configuraveis globalmente. Defaults =
  // preset ORGANICO "forte" (0.75 / 0.95 / 0.4s), escolhido em A/B pelo operador
  // para um som mais natural (fonte unica em PIPER_DEFAULT_SYNTH_PARAMS). Sao a
  // superficie global; a afinacao por-voz vive em VOICE_PARAM_OVERRIDES
  // (src/tts/calibration.ts). Continuam env-overridable via NOISE_*/SENTENCE_SILENCE.
  noiseScale: number;
  noiseW: number;
  sentenceSilence: number;
  // Circuit-breaker do gTTS: após N falhas CONSECUTIVAS da Google (bloqueio/timeout
  // de ~15s), o motor "abre" e serve o Piper diretamente durante o cooldown, sem
  // voltar a tentar o gTTS — para não acumular stalls de 15s por mensagem. Uma
  // síntese bem-sucedida fecha-o. Env: GTTS_BREAKER_THRESHOLD / GTTS_BREAKER_COOLDOWN_MS.
  gttsBreakerThreshold: number;
  gttsBreakerCooldownMs: number;
  // Máx. de pedaços do gTTS buscados EM PARALELO à Google (mensagens longas partem-se
  // em ≤200 chars). Default 3; 1 reproduz o comportamento serial antigo. Concorrência
  // alta multiplica a taxa instantânea de pedidos (mais risco de 429). Env: GTTS_CHUNK_CONCURRENCY.
  gttsChunkConcurrency: number;
  // Clone de voz (/voice clone): comando que lança o sidecar Python do motor de
  // cloning (ex. "C:\\...\\venv\\Scripts\\python.exe C:\\...\\tools\\clone_server.py").
  // AUSENTE => a gravação/gestão de amostras funciona, mas a síntese clonada fica
  // desativada (fallback à voz normal) até o operador instalar o motor (setup na
  // Vaga 2). Env: CLONE_CMD.
  cloneCmd?: string;
  // Kokoro (motor neural OPT-IN, /voice set engine:Kokoro): comando do sidecar Python
  // (auto-deteta tools/kokoro-venv + modelo se ausente). SEM sidecar => escolher Kokoro
  // serve o gTTS (nunca silêncio). Env: KOKORO_CMD.
  kokoroCmd?: string;
  // Línguas que o Kokoro serve (as outras caem no gTTS via RouterEngine). Prefixos de
  // locale (o que langKeyOfModel devolve). Default = as validadas no spike (sem 'zh',
  // que precisa de misaki[zh]). Env KOKORO_LANGS = csv, ex. "en,pt,es".
  kokoroLangs: Set<string>;
  // Canal de suporte/denúncia mostrado no /help. A Política de Desenvolvedor do
  // Discord exige que o utilizador tenha uma forma de reportar problemas/violações;
  // este link satisfaz esse requisito. Default = servidor de suporte oficial do
  // Vozen; um self-hoster aponta o SEU via env SUPPORT_URL.
  supportUrl: string;
  // Premium Apps do Discord (monetização nativa). IDs dos SKUs criados no Developer
  // Portal DEPOIS de a app estar verificada e a onboarding de monetização feita.
  // AUSENTES => o subsistema de entitlements fica INERTE (só /redeem). Env:
  // PREMIUM_GUILD_SKU_ID (subscrição por-servidor ≙ Premium) e PREMIUM_USER_SKU_ID
  // (subscrição por-utilizador ≙ Plus).
  premiumGuildSkuId?: string;
  premiumUserSkuId?: string;
  // Página do Ko-fi onde se compra o Premium/Plus. Mostrada no /premium info e nos erros
  // "não tens passe". Env KOFI_URL; default = página genérica (o operador põe a sua).
  kofiUrl: string;
  // Comandos OWNER-ONLY (/vozengrant): defesa em profundidade. O comando é registado SÓ
  // na OWNER_GUILD_ID (guild command) — o público nem o vê. Além disso o handler verifica
  // o invocador contra o dono REAL resolvido via client.application (User/Team) no arranque;
  // OWNER_ID é um fallback explícito. Sem OWNER_GUILD_ID o comando não é registado.
  ownerGuildId?: string;
  ownerId?: string;
  // Webhook do Ko-fi (compras -> premium). Token de verificação (Ko-fi > Settings > API);
  // AUSENTE => o servidor de webhook NÃO arranca (inerte). Porta do endpoint HTTP local.
  kofiWebhookToken?: string;
  kofiWebhookPort: number;
  // Painel Premium do site (login com Discord -> GET /api/me/premium no MESMO servidor HTTP).
  // OPT-IN: PREMIUM_API_ENABLED=true monta a API. PREMIUM_API_ORIGIN é a origem do site
  // permitida no CORS (só ela pode chamar a API do browser). Sem enable => inerte.
  premiumApiEnabled: boolean;
  premiumApiOrigin: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function strEnv(name: string, fallback: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return fallback;
  return value;
}

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Numero que TEM de ser POSITIVO (> 0). Ausente/vazio => fallback. Valor
 * nao-numerico, <= 0, ou (se `integer`) nao-inteiro => AVISA e usa o fallback, em
 * vez de aceitar em silencio. Racional: `RATE_PER_MIN=0` / `QUEUE_CAP=0` /
 * `MAX_CHARS=0` (typo) tornavam o bot silenciosamente MUDO (fila/limitador rejeitam
 * tudo) sem explicacao. Degradar para o default seguro + avisar e melhor do que um
 * bot morto silencioso OU um crash-loop de arranque.
 */
function numEnvPositive(name: string, fallback: number, opts: { integer?: boolean } = {}): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  const bad =
    !Number.isFinite(parsed) || parsed <= 0 || (opts.integer && !Number.isInteger(parsed));
  if (bad) {
    log.warn(
      `[config] ${name}="${raw}" invalido (esperado ${opts.integer ? 'inteiro ' : ''}> 0). A usar o default ${fallback}.`,
    );
    return fallback;
  }
  return parsed;
}

/**
 * Numero OPCIONAL: ausente/vazio => undefined (ao contrario de numEnv, que tem
 * sempre fallback). Valor nao-numerico tambem => undefined — a escolha
 * defensiva, consistente com o resto do modulo: nao arrancamos um servidor por
 * causa de um typo na env. Usado por HEALTH_PORT (sem porta => sem servidor).
 */
function numEnvOptional(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Flag booleana OPT-OUT (default `true`): a feature esta LIGADA a menos que a env
 * a desligue EXPLICITAMENTE. So o valor exato 'false' (case-insensitive) desliga;
 * qualquer outra coisa (ausente, vazio, 'true', '1', typo) fica ON. E o espelho do
 * boolEnv para features que sao o comportamento por defeito mas queremos um
 * kill-switch global via env.
 */
function boolEnvDefaultOn(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined) return true;
  return raw.trim().toLowerCase() !== 'false';
}

/**
 * Flag booleana OPT-IN (default `false`): a feature está DESLIGADA a menos que a
 * env a ligue EXPLICITAMENTE com o valor exato 'true' (case-insensitive). Espelho
 * do boolEnvDefaultOn, para opt-ins perigosos que nunca devem ligar por typo.
 */
function boolEnvDefaultOff(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined) return false;
  return raw.trim().toLowerCase() === 'true';
}

/**
 * Le TTS_ENGINE. Default 'piper'. Valor invalido (que nao 'piper'/'neural')
 * cai em 'piper' com um aviso no stderr — o Piper e o default seguro e nunca
 * precisa de API key, por isso degradar para ele e preferivel a crashar o
 * arranque por um typo na env. (A combinacao 'neural' sem OPENAI_API_KEY essa
 * sim falha rapido — ver createEngine.)
 */
function engineEnv(): TtsEngineKind {
  const raw = process.env.TTS_ENGINE;
  if (raw === undefined || raw.trim() === '') return 'piper';
  const value = raw.trim().toLowerCase();
  if (value === 'piper' || value === 'neural' || value === 'gtts' || value === 'router')
    return value;
  log.warn(
    `[config] TTS_ENGINE invalido: "${raw}". Valores aceites: piper | neural | gtts | router. A usar 'piper'.`,
  );
  return 'piper';
}

export function loadConfig(): AppConfig {
  return {
    token: requireEnv('DISCORD_TOKEN'),
    clientId: requireEnv('CLIENT_ID'),
    piperPath: strEnv('PIPER_PATH', 'piper'),
    modelsDir: strEnv('MODELS_DIR', './models'),
    dbPath: strEnv('DB_PATH', './tts.db'),
    defaultVoice: strEnv('DEFAULT_VOICE', 'en_US-amy-medium'),
    defaultSpeed: numEnvPositive('DEFAULT_SPEED', 1), // > 0 (fracionario ok: 0.5–2.0)
    inactivityMs: numEnv('INACTIVITY_MS', 1_500_000), // 25 min sem atividade -> sai do canal
    messageLeadMs: numEnv('MESSAGE_LEAD_MS', 200), // 0.20s (0 = sem espera, por isso NÃO exige > 0)
    queueCap: numEnvPositive('QUEUE_CAP', 20, { integer: true }),
    maxChars: numEnvPositive('MAX_CHARS', 300, { integer: true }),
    ratePerMin: numEnvPositive('RATE_PER_MIN', 5, { integer: true }),
    ttsEngine: engineEnv(),
    openaiApiKey: strEnv('OPENAI_API_KEY', '') || undefined,
    // P9.3 — texto opcional da presenca; vazio/ausente => undefined e buildPresence
    // usa o seu default de marca. Override exato quando definido.
    presenceText: strEnv('PRESENCE_TEXT', '') || undefined,
    // P9.7 — porta OPCIONAL do health endpoint HTTP (uptime monitors). Ausente
    // => undefined => NAO arranca servidor nenhum (default). Definida => numero.
    healthPort: numEnvOptional('HEALTH_PORT'),
    // P11.4 — valor CRU do BOT_SHARDS (opt-in de sharding). Ausente/vazio =>
    // undefined => single-process (default). A interpretacao (auto / N / single) e
    // feita por resolveShardCount no launcher src/shard.ts — aqui so transportamos
    // a string.
    // NB: a env chama-se BOT_SHARDS e NAO `SHARDS` de proposito. `SHARDS` (e
    // `SHARD_COUNT`) sao reservadas: o construtor do Client do discord.js le-as
    // diretamente de process.env. Num arranque single-process (`npm start`),
    // `SHARDS=auto` faria `JSON.parse('auto')` crashar o Client, e `SHARDS=N`
    // configuraria o processo como um shard isolado — partindo o default. Manter
    // o nome distinto isola o opt-in do mecanismo interno do discord.js.
    shards: strEnv('BOT_SHARDS', '') || undefined,
    // P11.5 — webhook top.gg OPCIONAL. TOPGG_WEBHOOK_PORT ausente/vazio/invalido
    // => undefined => NAO arranca servidor de webhook (default), igual ao
    // HEALTH_PORT. TOPGG_WEBHOOK_SECRET ausente/vazio => undefined => webhook sem
    // auth (inseguro; ver startVoteWebhookServer, que avisa nesse caso). Porta
    // dedicada, separada do HEALTH_PORT de proposito.
    topggWebhookPort: numEnvOptional('TOPGG_WEBHOOK_PORT'),
    topggWebhookSecret: strEnv('TOPGG_WEBHOOK_SECRET', '') || undefined,
    topggWebhookAllowInsecure: boolEnvDefaultOff('TOPGG_WEBHOOK_ALLOW_INSECURE'),
    topggToken: strEnv('TOPGG_TOKEN', '') || undefined,
    errorWebhookUrl: strEnv('ERROR_WEBHOOK_URL', '') || undefined,
    // Sintese multi-lingua por-segmento — LIGADA por defeito: sem esta env (ou com
    // qualquer valor != 'false'), o Vozen mistura vozes por lingua. Kill-switch
    // global: MULTILINGUAL_SEGMENTS=false forca voz unica por frase.
    multilingualSegments: boolEnvDefaultOn('MULTILINGUAL_SEGMENTS'),
    // Params de qualidade Piper. Defaults = preset ORGANICO (fonte unica em
    // PIPER_DEFAULT_SYNTH_PARAMS = 0.75/0.95/0.4). numEnv faz parsing seguro:
    // env ausente/vazia/nao-numerica cai no default; env valida ganha por cima.
    noiseScale: numEnv('NOISE_SCALE', PIPER_DEFAULT_SYNTH_PARAMS.noiseScale),
    noiseW: numEnv('NOISE_W', PIPER_DEFAULT_SYNTH_PARAMS.noiseW),
    sentenceSilence: numEnv('SENTENCE_SILENCE', PIPER_DEFAULT_SYNTH_PARAMS.sentenceSilence),
    // Circuit-breaker do gTTS: 3 falhas consecutivas -> abre 60s (usa o Piper). Ambos
    // > 0 (numEnvPositive): um threshold/cooldown 0 desligaria a proteção sem querer.
    gttsBreakerThreshold: numEnvPositive('GTTS_BREAKER_THRESHOLD', 3, { integer: true }),
    gttsBreakerCooldownMs: numEnvPositive('GTTS_BREAKER_COOLDOWN_MS', 60_000, { integer: true }),
    gttsChunkConcurrency: numEnvPositive('GTTS_CHUNK_CONCURRENCY', 3, { integer: true }),
    // Clone de voz: comando do sidecar Python (ausente => síntese clonada desativada;
    // a gravação/gestão de amostras funciona na mesma).
    cloneCmd: process.env.CLONE_CMD?.trim() || undefined,
    // Kokoro: comando do sidecar (ausente => auto-deteta tools/kokoro-venv).
    kokoroCmd: process.env.KOKORO_CMD?.trim() || undefined,
    // Línguas do Kokoro: csv KOKORO_LANGS (prefixos), ou as validadas no spike por defeito.
    kokoroLangs: new Set(
      (process.env.KOKORO_LANGS?.trim()
        ? process.env.KOKORO_LANGS.split(',')
        : ['en', 'es', 'fr', 'hi', 'it', 'pt', 'ja']
      )
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
    // Canal de suporte/denúncia (requisito da Política de Desenvolvedor do Discord).
    // Default = servidor de suporte oficial do Vozen; override por SUPPORT_URL.
    supportUrl: strEnv('SUPPORT_URL', 'https://discord.gg/V6PZYZmhcQ'),
    // Premium Apps (monetização nativa). Ausentes => entitlements inertes (só /redeem).
    premiumGuildSkuId: strEnv('PREMIUM_GUILD_SKU_ID', '') || undefined,
    premiumUserSkuId: strEnv('PREMIUM_USER_SKU_ID', '') || undefined,
    // Página do Ko-fi (compra do Premium/Plus). O operador define KOFI_URL com a sua.
    kofiUrl: strEnv('KOFI_URL', 'https://ko-fi.com/'),
    // Owner-only: servidor de controlo (onde o /vozengrant é registado) + dono explícito.
    ownerGuildId: strEnv('OWNER_GUILD_ID', '') || undefined,
    ownerId: strEnv('OWNER_ID', '') || undefined,
    // Webhook do Ko-fi: sem token => não arranca. Porta local do endpoint.
    kofiWebhookToken: strEnv('KOFI_WEBHOOK_TOKEN', '') || undefined,
    kofiWebhookPort: numEnvPositive('KOFI_WEBHOOK_PORT', 3001, { integer: true }),
    // Painel Premium: opt-in explícito (default off). Origem = página do site (GitHub Pages).
    premiumApiEnabled: boolEnvDefaultOff('PREMIUM_API_ENABLED'),
    premiumApiOrigin: strEnv('PREMIUM_API_ORIGIN', 'https://rexy40407.github.io'),
  };
}
