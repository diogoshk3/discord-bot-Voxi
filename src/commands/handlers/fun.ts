// src/commands/handlers/fun.ts — handlers divertidos: /laugh, /joke, /rizz, micro-fun (/8ball,/fortune,/fact,/wyr) e /birthday extraídos de index.ts (plano 015).
import { join } from 'node:path';
import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import type { BotDeps } from '../../bot/deps';
import { getPlayer, getLimiter } from '../../bot/deps';
import { getUserVoice } from '../../store/userVoice';
import { resolveUserEngine } from '../../tts/resolveEngine';
import { getGuildConfig } from '../../store/guildConfig';
import { isGuildPremium, isUserPremium } from '../../store/premium';
import { getBirthday, setBirthday, clearBirthday, isValidBirthday } from '../../store/birthday';
import type { SynthRequest } from '../../tts/engine';
import { laughterFor } from '../../content/laughter';
import { jokeLangByKey, pickJoke } from '../../content/jokes';
import { pickLine } from '../../content/pickupLines';
import { SOUNDS, soundByKey, soundFilename } from '../../content/sounds';
import {
  funLocaleOf,
  pickEightball,
  pickFortune,
  pickFact,
  pickWyr,
  type FunLocale,
} from '../../content/microfun';
import { t } from '../../i18n/index';
import { localeForUser, localePrefixOf, reply } from '../helpers';

/**
 * /laugh — o Vozen ri na voz ATUALMENTE selecionada pelo utilizador. Por-utilizador
 * (como /tts), sem gate de admin, mas exige um player ativo (user numa call). A voz
 * e RESOLVIDA por precedencia (voz do user > default da guild > .env) e o riso e
 * escolhido pela LINGUA dessa voz (nao por deteccao) — por isso construimos o
 * SynthRequest DIRETAMENTE, sem passar por resolveSynth/detectLang (mesma logica do
 * /voice preview: a lingua e conhecida, nao detetada).
 */
export async function handleLaugh(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  // A sintese pode demorar; defer imediato para nao perder o token (3s).
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const locale = localeForUser(deps, i);
  const player = getPlayer(deps, i.guildId!);
  if (!player) {
    await i.editReply(t('tts.notInVoice', locale));
    return;
  }
  const cfg = getGuildConfig(deps.db, i.guildId!);

  // rate-limit por-utilizador (MESMO limiter do /tts): sem isto o /laugh enfileirava
  // sem limite -> vetor de spam da fila de voz. Corre APOS o deferReply para o
  // editReply funcionar.
  const rl = getLimiter(deps, i.guildId!, cfg.ratePerMin);
  if (!rl.allow(i.user.id, Date.now())) {
    await i.editReply(t('tts.tooFast', locale));
    return;
  }

  const stored = getUserVoice(deps.db, i.guildId!, i.user.id);
  // Precedencia da voz: voz guardada do user > default_voice da guild > .env > amy.
  const model = stored?.model || cfg.defaultVoice || deps.config.defaultVoice || 'en_US-amy-medium';
  const speed = stored?.speed ?? deps.config.defaultSpeed;
  // singleVoice: a voz e DELIBERADAMENTE escolhida (a voz atual do user); a deteccao
  // nunca deve sobrepor-se nem partir o riso por lingua.
  const req: SynthRequest = {
    text: laughterFor(localePrefixOf(model)),
    model,
    speed,
    singleVoice: true,
    // ri no MESMO motor que o user escolheu; o resolver aplica o gate gcloud (->google
    // sem Premium) e anexa o orçamento (Fase 3) — devolve engine + gcloudBudget.
    ...resolveUserEngine(deps.db, i.guildId!, i.user.id, stored?.engine, Date.now()),
  };
  // say() devolve false quando a fila esta no cap: nesse caso reutilizamos tts.busy.
  const queued = await player.say(req);
  await i.editReply(queued ? t('laugh.playing', locale) : t('tts.busy', locale));
}

/**
 * Pausa (ms) entre a piada e o riso no /joke. O riso e uma fala SEPARADA que leva
 * este valor em `leadSilenceMs` (silencio PREPENDido), criando um intervalo real —
 * o Vozen fala a piada, espera ~1s, e SO DEPOIS ri.
 */
const JOKE_LAUGH_PAUSE_MS = 1000;

/**
 * /joke — conta uma piada curta na LINGUA escolhida (`idioma`, autocomplete). A voz
 * e escolhida pela LINGUA (primeiro modelo de deps.availableModels cujo nome comeca
 * pelo prefixo da lingua; se nenhum, cai no default da guild/.env). Se `risos` for
 * true, acrescenta o riso dessa lingua no fim. Como a lingua e CONHECIDA (escolhida,
 * nao detetada), construimos o SynthRequest diretamente — sem resolveSynth/detectLang
 * (mesma logica do /voice preview e do /laugh).
 */
export async function handleJoke(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const locale = localeForUser(deps, i);
  const player = getPlayer(deps, i.guildId!);
  if (!player) {
    await i.editReply(t('tts.notInVoice', locale));
    return;
  }
  const langKey = i.options.getString('language', true);
  const lang = jokeLangByKey(langKey);
  if (!lang) {
    await i.editReply(t('joke.unknownLang', locale));
    return;
  }
  const risos = i.options.getBoolean('laughter', true);

  // Voz para a lingua escolhida: 1.º modelo instalado com o prefixo; se nao houver
  // (a lingua nao tem modelo instalado), cai no default da guild / .env / amy.
  const cfg = getGuildConfig(deps.db, i.guildId!);

  // rate-limit por-utilizador (MESMO limiter do /tts): sem isto o /joke enfileirava
  // sem limite -> vetor de spam da fila de voz. Corre APOS o deferReply para o
  // editReply funcionar.
  const rl = getLimiter(deps, i.guildId!, cfg.ratePerMin);
  if (!rl.allow(i.user.id, Date.now())) {
    await i.editReply(t('tts.tooFast', locale));
    return;
  }

  const model =
    deps.availableModels.find((m) => m.startsWith(lang.prefix)) ||
    cfg.defaultVoice ||
    deps.config.defaultVoice ||
    'en_US-amy-medium';

  // O MODELO (voz) do /joke é escolhido pela LÍNGUA, mas o MOTOR (google/piper) deve
  // seguir a escolha do utilizador — tal como /laugh e /voice preview. Sem isto, um
  // user de Piper ouvia as piadas no Google (inconsistente com tudo o resto).
  const stored = getUserVoice(deps.db, i.guildId!, i.user.id);
  // Resolver partilhado: gcloud->google sem Premium (gate) + orçamento (Fase 3).
  const resolvedEngine = resolveUserEngine(
    deps.db,
    i.guildId!,
    i.user.id,
    stored?.engine,
    Date.now(),
  );

  // pickJoke e PURO/seeded; em runtime usamos Date.now() como seed (variedade sem
  // sacrificar a testabilidade determinista da funcao).
  const joke = pickJoke(langKey, Date.now());
  const speed = deps.config.defaultSpeed;

  // Enfileira SEMPRE a piada sozinha primeiro. O reply baseia-se NESTA fala: se a
  // fila estiver cheia (say false), respondemos busy e nao enfileiramos o riso.
  // singleVoice: a lingua da piada e CONHECIDA (escolhida), a deteccao nao manda.
  const queued = await player.say({
    text: joke,
    model,
    speed,
    singleVoice: true,
    ...resolvedEngine,
  });

  // Se `risos` E a piada entrou na fila, enfileira o RISO como fala SEPARADA com uma
  // pausa real de 2s A FRENTE (leadSilenceMs). Assim o Vozen fala a piada, PAUSA ~2s,
  // e SO DEPOIS ri (em vez de rir colado ao fim da piada, como antes). O riso e
  // best-effort: se a fila enche entretanto, simplesmente nao ri (o reply ja reflete
  // a piada). Duas fila-items: um /skip durante a piada nao apanha o riso — aceitavel.
  if (queued && risos) {
    await player.say({
      text: laughterFor(lang.prefix),
      model,
      speed,
      ...resolvedEngine,
      leadSilenceMs: JOKE_LAUGH_PAUSE_MS,
      // singleVoice: sem isto, um edge-case multi-script perderia o leadSilenceMs
      // (o caminho por-segmento chama base.synth sem ele). A lingua e conhecida.
      singleVoice: true,
    });
  }

  // Confirmacao inclui a piada escrita (o user ve o que esta a ser lido).
  await i.editReply(queued ? t('joke.playing', locale, { joke }) : t('tts.busy', locale));
}

// Efeito sonoro do /rizz: um WAV pronto em assets/sfx/ (raiz do repo). Em runtime este
// modulo vive em dist/commands/handlers/, por isso subimos 3 niveis ate a raiz (mesmo
// padrao das wordlists em games/wordchain/dict.ts). O silencio de pausa esta EMBUTIDO no
// ficheiro (o assetPath salta os motores, onde vive o leadSilenceMs). Trocavel: basta
// substituir o ficheiro por outro WAV.
const RIZZ_SFX_PATH = join(__dirname, '..', '..', '..', 'assets', 'sfx', 'rizz.wav');

/**
 * /rizz — manda uma pick-up line (frase de engate) na LINGUA escolhida (`language`,
 * autocomplete — o MESMO do /joke), falada na voz dessa lingua. Se `sound` for true,
 * toca a seguir o efeito sonoro "rizz" como fala SEPARADA que o player reproduz DIRETO
 * (assetPath, sem motor/cache/efeitos). Mesma logica de voz/motor do /joke.
 */
export async function handleRizz(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const locale = localeForUser(deps, i);

  // 💎 GATE: /rizz é Premium (Plus do próprio OU Premium do servidor). Mesmo padrão do
  // /voice clone, /voice effect e dos jogos Premium. Checado cedo — nem gera a frase.
  const now = Date.now();
  const premium =
    isUserPremium(deps.db, i.user.id, now) || isGuildPremium(deps.db, i.guildId!, now);
  if (!premium) {
    await i.editReply(t('rizz.locked', locale));
    return;
  }

  const player = getPlayer(deps, i.guildId!);
  if (!player) {
    await i.editReply(t('tts.notInVoice', locale));
    return;
  }
  const langKey = i.options.getString('language', true);
  const lang = jokeLangByKey(langKey);
  if (!lang) {
    await i.editReply(t('rizz.unknownLang', locale));
    return;
  }
  const sound = i.options.getBoolean('sound', true);
  const cfg = getGuildConfig(deps.db, i.guildId!);

  // rate-limit por-utilizador (MESMO limiter do /tts e /joke): APOS o deferReply.
  const rl = getLimiter(deps, i.guildId!, cfg.ratePerMin);
  if (!rl.allow(i.user.id, Date.now())) {
    await i.editReply(t('tts.tooFast', locale));
    return;
  }

  const model =
    deps.availableModels.find((m) => m.startsWith(lang.prefix)) ||
    cfg.defaultVoice ||
    deps.config.defaultVoice ||
    'en_US-amy-medium';
  const stored = getUserVoice(deps.db, i.guildId!, i.user.id);
  // segue o motor do user (como /joke e /laugh), com o gate gcloud + orçamento (Fase 3).
  const resolvedEngine = resolveUserEngine(
    deps.db,
    i.guildId!,
    i.user.id,
    stored?.engine,
    Date.now(),
  );

  const line = pickLine(langKey, Date.now());
  const speed = deps.config.defaultSpeed;

  // Enfileira SEMPRE a frase sozinha primeiro; o reply baseia-se NESTA fala.
  const queued = await player.say({
    text: line,
    model,
    speed,
    singleVoice: true,
    ...resolvedEngine,
  });

  // Efeito sonoro "rizz" a seguir (fala SEPARADA, tocada direto via assetPath — sem motor
  // nem cache). Best-effort: se a fila encher entretanto, simplesmente nao toca o efeito
  // (o reply ja reflete a frase). `text: ''` -> sem ganho de enfase.
  if (queued && sound) {
    await player.say({ text: '', model, speed, singleVoice: true, assetPath: RIZZ_SFX_PATH });
  }

  await i.editReply(queued ? t('rizz.playing', locale, { line }) : t('tts.busy', locale));
}

// Diretório dos clips do soundboard (raiz do repo /assets/sfx). Em runtime este modulo
// vive em dist/commands/handlers/, por isso subimos 3 niveis (mesmo padrao do RIZZ_SFX_PATH).
const SFX_DIR = join(__dirname, '..', '..', '..', 'assets', 'sfx');

/**
 * /sound [name] — toca um clip curto do soundboard na call (biblioteca CURADA, sem
 * upload). Sem `name`, responde com a LISTA de sons (descoberta). O clip e tocado DIRETO
 * via assetPath (sem motor/cache/efeitos) — a mesma canalizacao do efeito do /rizz. Exige
 * um player ativo (bot numa call) e tem rate-limit por-utilizador (anti-spam sonoro).
 */
export async function handleSound(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const locale = localeForUser(deps, i);

  // Kill-switch por-servidor: um admin pode desligar o /sound com /config soundboard.
  const cfg = getGuildConfig(deps.db, i.guildId!);
  if (!cfg.soundboard) {
    await i.editReply(t('sound.disabled', locale));
    return;
  }

  // Sem argumento -> lista os sons disponiveis (nao precisa de estar numa call).
  const key = i.options.getString('name');
  if (!key) {
    const list = SOUNDS.map((s) => `${s.emoji ?? '🔊'} \`${s.key}\``).join(' · ');
    await i.editReply(t('sound.list', locale, { sounds: list }));
    return;
  }

  // `name` vem de choices, mas via API pode chegar uma key invalida -> mensagem clara.
  const clip = soundByKey(key);
  if (!clip) {
    await i.editReply(t('sound.unknown', locale));
    return;
  }

  const player = getPlayer(deps, i.guildId!);
  if (!player) {
    await i.editReply(t('tts.notInVoice', locale));
    return;
  }

  // rate-limit por-utilizador (MESMO limiter do /tts): sem isto um user podia encher a
  // fila de voz com clips e afogar o TTS de toda a gente. APOS o deferReply.
  const rl = getLimiter(deps, i.guildId!, cfg.ratePerMin);
  if (!rl.allow(i.user.id, Date.now())) {
    await i.editReply(t('tts.tooFast', locale));
    return;
  }

  // Clip fixo tocado DIRETO (assetPath salta motor/cache/efeitos). model/speed sao
  // placeholders exigidos pelo tipo SynthRequest — ignorados quando ha assetPath.
  const model = cfg.defaultVoice || deps.config.defaultVoice || 'en_US-amy-medium';
  const queued = await player.say({
    text: '',
    model,
    speed: deps.config.defaultSpeed,
    singleVoice: true,
    assetPath: join(SFX_DIR, soundFilename(clip.key)),
  });
  await i.editReply(
    queued ? t('sound.playing', locale, { name: clip.name }) : t('tts.busy', locale),
  );
}

type MicroFunKind = '8ball' | 'fortune' | 'fact' | 'wyr';

/**
 * Micro-comandos divertidos (/8ball, /fortune, /fact, /wyr): escolhem uma frase do banco
 * na LÍNGUA DA UI do utilizador (EN/PT) e respondem PUBLICAMENTE em texto; se o Vozen
 * estiver na call, também a FALA (voz da língua da frase, motor do utilizador). Ao
 * contrário do /joke, funcionam FORA de uma call (texto na mesma). A fala é best-effort e
 * rate-limited (mesmo limiter do /tts): rate-limit -> texto na mesma, sem falar.
 */
export async function handleMicroFun(
  i: ChatInputCommandInteraction,
  deps: BotDeps,
  kind: MicroFunKind,
): Promise<void> {
  await i.deferReply();
  const locale = localeForUser(deps, i);
  const funLoc: FunLocale = funLocaleOf(locale);
  const seed = Date.now();

  let spoken: string;
  let replyText: string;
  switch (kind) {
    case '8ball': {
      const question = i.options.getString('question', true);
      spoken = pickEightball(funLoc, seed);
      replyText = t('fun.eightball', locale, { question, answer: spoken });
      break;
    }
    case 'fortune':
      spoken = pickFortune(funLoc, seed);
      replyText = t('fun.fortune', locale, { text: spoken });
      break;
    case 'fact':
      spoken = pickFact(funLoc, seed);
      replyText = t('fun.fact', locale, { text: spoken });
      break;
    case 'wyr':
      spoken = pickWyr(funLoc, seed);
      replyText = t('fun.wyr', locale, { text: spoken });
      break;
  }

  // Fala (best-effort): só se o Vozen estiver na call E o utilizador não estiver rate-limited.
  const player = getPlayer(deps, i.guildId!);
  if (player) {
    const cfg = getGuildConfig(deps.db, i.guildId!);
    const rl = getLimiter(deps, i.guildId!, cfg.ratePerMin);
    if (rl.allow(i.user.id, Date.now())) {
      const prefix = funLoc === 'pt' ? 'pt_' : 'en_';
      const model =
        deps.availableModels.find((m) => m.startsWith(prefix)) ||
        cfg.defaultVoice ||
        deps.config.defaultVoice ||
        'en_US-amy-medium';
      const stored = getUserVoice(deps.db, i.guildId!, i.user.id);
      const resolvedEngine = resolveUserEngine(
        deps.db,
        i.guildId!,
        i.user.id,
        stored?.engine,
        Date.now(),
      );
      // singleVoice: a língua da frase é CONHECIDA (o banco), a deteção não manda.
      void player.say({
        text: spoken,
        model,
        speed: deps.config.defaultSpeed,
        singleVoice: true,
        ...resolvedEngine,
      });
    }
  }

  await i.editReply(replyText);
}

/**
 * /birthday set|clear|show — regista o dia de anos (mês+dia, sem ano) por-(guild,user).
 * No dia, quando a pessoa entra na call do Vozen, ele diz "Parabéns" (greetOnJoin). Valida
 * a combinação dia/mês (recusa 31/02 etc.). Respostas ephemeral no locale do próprio.
 */
export async function handleBirthday(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  const sub = i.options.getSubcommand();
  if (sub === 'set') {
    const day = i.options.getInteger('day', true);
    const month = i.options.getInteger('month', true);
    if (!isValidBirthday(month, day)) {
      await reply(i, t('birthday.invalid', locale));
      return;
    }
    setBirthday(deps.db, i.guildId!, i.user.id, month, day);
    await reply(i, t('birthday.set', locale, { day, month }));
  } else if (sub === 'clear') {
    clearBirthday(deps.db, i.guildId!, i.user.id);
    await reply(i, t('birthday.cleared', locale));
  } else {
    // show
    const bd = getBirthday(deps.db, i.guildId!, i.user.id);
    await reply(
      i,
      bd
        ? t('birthday.show', locale, { day: bd.day, month: bd.month })
        : t('birthday.none', locale),
    );
  }
}
