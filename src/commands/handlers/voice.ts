// src/commands/handlers/voice.ts — handler de /voice (set/list/reset/optout/optin/preview/detection/nickname/effect + grupo clone) extraído de index.ts (plano 015).
import {
  ChatInputCommandInteraction,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';
import type { BotDeps } from '../../bot/deps';
import { getPlayer, getLimiter } from '../../bot/deps';
import { brandEmbed } from '../../ui/theme';
import { getUserVoice, setUserVoice, resetUserVoice } from '../../store/userVoice';
import { getGuildConfig } from '../../store/guildConfig';
import { setOptOut, setOptIn } from '../../store/optout';
import { setNickname, clearNickname } from '../../store/nickname';
import { isGuildPremium, isUserPremium } from '../../store/premium';
import { setVoiceEffect } from '../../store/voiceEffect';
import { isVoiceEffect, isPremiumEffect, effectLabel, type VoiceEffect } from '../../tts/effects';
import { sanitizeSpeakerName } from '../../language/speakerName';
import { formatVoiceList, makeLocalizedNamer } from '../../language/voiceMap';
import type { SynthRequest } from '../../tts/engine';
import { resolveUserEngine } from '../../tts/resolveEngine';
import {
  getClone,
  saveClone,
  setCloneEnabled,
  deleteClone,
  deleteClonesByTarget,
} from '../../store/voiceClone';
import { recordUserSample, pcmToWavFile } from '../../voice/recorder';
import { encryptSampleFileInPlace } from '../../tts/cloneSampleFile';
import { join, dirname } from 'node:path';
import { unlinkSync, rmSync } from 'node:fs';
import { log } from '../../logging/logger';
import { t } from '../../i18n/index';
import { localeFor, localeForUser, reply } from '../helpers';

// Utilizadores com uma gravação /voice clone record EM CURSO. BUG real descoberto
// (auditoria): connection.receiver.subscribe(userId, ...) do @discordjs/voice devolve
// SEMPRE o MESMO stream partilhado para um userId já subscrito — duas invocações
// concorrentes do MESMO utilizador (duplo-toque, duas sessões) partilhavam o áudio e
// corrompiam-se mutuamente (a primeira a terminar destruía o stream da segunda a meio).
// Este guard bloqueia a 2.ª invocação com uma mensagem clara em vez de deixar as duas
// gravações pisarem-se. Limpo SEMPRE no finally da 1.ª (sucesso, "curto demais" ou erro).
const activeCloneRecordings = new Set<string>();

/**
 * /voice clone record|use|status|delete — clone da PRÓPRIA voz, consent-first:
 *   - record: grava SÓ o áudio do invocador (receiver por-user) durante ~15s de fala;
 *     o próprio comando é o consentimento (registado com timestamp). O bot vive
 *     ensurdecido e só "destapa os ouvidos" durante a janela de gravação.
 *   - use: liga/desliga a leitura das PRÓPRIAS mensagens com o clone (ninguém mais
 *     pode usar o clone de outra pessoa). Sem motor instalado (config.cloneCmd), o
 *     toggle fica guardado mas avisa que a síntese ainda não está ativa.
 *   - delete: apaga amostra + registo, sem rasto.
 * record/use são 💎 Premium (Plus do próprio OU Premium do servidor).
 */
async function handleVoiceClone(
  i: ChatInputCommandInteraction,
  deps: BotDeps,
  locale: string,
): Promise<void> {
  const sub = i.options.getSubcommand();
  const userId = i.user.id;

  if (sub === 'status') {
    const c = getClone(deps.db, userId);
    if (!c) {
      await reply(i, t('clone.none', locale));
      return;
    }
    // Cartão: verde quando o clone está LIGADO, blurple quando só gravado.
    const embed = brandEmbed(c.enabled ? 'success' : 'brand').setDescription(
      t('clone.status', locale, {
        date: `<t:${Math.floor(c.consentAt / 1000)}:D>`,
        state: c.enabled ? t('clone.stateOn', locale) : t('clone.stateOff', locale),
      }),
    );
    await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (sub === 'delete') {
    // Apaga o MEU clone (sou o dono) E revoga qualquer clone feito a partir da MINHA voz
    // por outra pessoa (sou o alvo) — a pessoa gravada pode sempre retirar o consentimento.
    const ownPath = deleteClone(deps.db, userId);
    const revoked = deleteClonesByTarget(deps.db, userId);
    for (const p of [ownPath, ...revoked.map((r) => r.samplePath)]) {
      if (!p) continue;
      try {
        unlinkSync(p);
      } catch {
        // ficheiro já removido — o registo é o que importa
      }
    }
    if (!ownPath && revoked.length === 0) {
      await reply(i, t('clone.none', locale));
      return;
    }
    // "Sem rasto": além da amostra e do registo, purga a cache de ÁUDIO clonado gerado
    // (audio-cache/clone/) — as chaves são hashes irreversíveis, não dá para apagar só as
    // desta voz, por isso limpamos o namespace inteiro. É regenerável (re-sintetiza quando
    // preciso) e o clone é a única feature que grava a voz real de alguém — direito ao
    // apagamento (RGPD) exige não deixar áudio derivado para trás.
    try {
      rmSync(join(dirname(deps.config.dbPath), 'audio-cache', 'clone'), {
        recursive: true,
        force: true,
      });
    } catch {
      // cache inexistente/bloqueada — regenerável, não é fatal
    }
    const parts: string[] = [];
    if (ownPath) parts.push(t('clone.deleted', locale));
    if (revoked.length) parts.push(t('clone.revoked', locale, { count: revoked.length }));
    await reply(i, parts.join('\n'));
    return;
  }

  // record e use exigem Premium (é o exemplo canónico de "extras que custam computação").
  const now = Date.now();
  const premium = isUserPremium(deps.db, userId, now) || isGuildPremium(deps.db, i.guildId!, now);
  if (!premium) {
    await reply(i, t('clone.locked', locale));
    return;
  }

  if (sub === 'use') {
    const on = i.options.getBoolean('active', true);
    const ok = setCloneEnabled(deps.db, userId, on);
    if (!ok) {
      await reply(i, t('clone.noSample', locale));
      return;
    }
    // Disponibilidade REAL do motor (inclui o venv auto-detetado), não só o env CLONE_CMD —
    // senão dizíamos "motor não instalado" com o sidecar detetado e o clone a funcionar.
    const engineAvailable = deps.cloneAvailable ?? !!deps.config.cloneCmd;
    if (on && !engineAvailable) {
      await reply(i, t('clone.enabledNoEngine', locale));
      return;
    }
    await reply(i, on ? t('clone.enabled', locale) : t('clone.disabled', locale));
    return;
  }

  // ── record ──
  // Alvo escolhível: por defeito o próprio invocador (auto-clone, o caso consent-first
  // trivial); se `user` for outra pessoa, gravamos a voz DELA — mas só com o consentimento
  // explícito dela (botão), preservando a invariante "nunca gravar terceiros em silêncio".
  // A opção `user` é STRING+autocomplete (id da pessoa na call); vazio = o próprio. Se
  // vier texto que não é um id (escreveram à mão sem escolher da lista), pede para escolher.
  const rawTarget = i.options.getString('user')?.trim();
  if (rawTarget && !/^\d{5,25}$/.test(rawTarget)) {
    await reply(i, t('clone.pickFromList', locale));
    return;
  }
  const targetId = rawTarget || userId;
  const isSelf = targetId === userId;
  const who = `<@${targetId}>`;
  // Duração escolhível: segundos de FALA real a apanhar (5–30, default 15). O relógio-teto
  // e o mínimo aceitável derivam do alvo, para amostras curtas poderem funcionar.
  const seconds = Math.min(30, Math.max(5, i.options.getInteger('seconds') ?? 15));
  const targetVoicedMs = seconds * 1000;
  const maxWallMs = Math.min(90_000, Math.max(30_000, targetVoicedMs * 3));
  const minMs = Math.min(4_000, targetVoicedMs);

  const connection = getVoiceConnection(i.guildId!);
  const botChannelId = i.guild?.members.me?.voice?.channelId ?? null;
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  // A presença do ALVO no canal do bot é o que importa (é a voz dele que gravamos).
  const targetMember = await i.guild?.members.fetch(targetId).catch(() => null);
  const targetChannelId = targetMember?.voice?.channelId ?? null;
  if (!connection || !botChannelId) {
    await i.editReply({ content: t('clone.notInVoice', locale) });
    return;
  }
  if (targetChannelId !== botChannelId) {
    await i.editReply({
      content: isSelf
        ? t('clone.notInVoice', locale)
        : t('clone.targetNotInVoice', locale, { who }),
    });
    return;
  }
  if (activeCloneRecordings.has(targetId)) {
    await i.editReply({ content: t('clone.alreadyRecording', locale) });
    return;
  }
  // Reserva o alvo JÁ (antes da janela de consentimento de 60s), senão duas pessoas a
  // apontar à mesma vítima passavam ambas o has() e disparavam dois pedidos. Libertado em
  // TODAS as saídas: nos returns antecipados do consentimento e no finally da gravação.
  activeCloneRecordings.add(targetId);

  const { channelId } = connection.joinConfig;

  // CONSENTIMENTO (só quando o alvo não é o próprio): pede o OK explícito ao alvo com um
  // botão numa mensagem pública (que também o notifica). Sem "sim" dele, não se grava nada.
  if (!isSelf) {
    const ch = i.channel;
    if (!ch || !ch.isTextBased() || ch.isDMBased()) {
      activeCloneRecordings.delete(targetId);
      await i.editReply({ content: t('clone.failed', locale) });
      return;
    }
    // O alvo lê isto — usa o locale da guild (neutro), não o do invocador.
    const gLocale = localeFor(deps, i.guildId);
    const consentRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`cloneok:${targetId}`)
        .setLabel(t('clone.consentAllow', gLocale))
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId(`cloneno:${targetId}`)
        .setLabel(t('clone.consentDeny', gLocale))
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('✖️'),
    );
    await i.editReply({ content: t('clone.consentWaiting', locale, { who }) });
    const consentMsg = await ch.send({
      content: t('clone.consentRequest', gLocale, { invoker: `<@${userId}>`, target: seconds }),
      components: [consentRow],
    });
    const granted = await new Promise<boolean>((resolve) => {
      const col = consentMsg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60_000,
      });
      col.on('collect', (btn) => {
        if (btn.user.id !== targetId) {
          void btn.reply({
            content: t('clone.consentNotYou', gLocale),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const ok = btn.customId.startsWith('cloneok:');
        void btn.update({
          content: t(ok ? 'clone.consentGranted' : 'clone.consentRefused', gLocale, { who }),
          components: [],
        });
        resolve(ok);
        col.stop('answered');
      });
      col.on('end', (_c, reason) => {
        if (reason !== 'answered') resolve(false);
      });
    });
    if (!granted) {
      activeCloneRecordings.delete(targetId);
      await i.editReply({ content: t('clone.consentRefused', locale, { who }) }).catch(() => {});
      await consentMsg.edit({ components: [] }).catch(() => {}); // limpa botões se foi timeout
      return;
    }
  }

  // Handle mínimo (só o .stop() que o finally precisa) guardado FORA do try, para o
  // finally poder parar o collector em QUALQUER saída — incluindo se recordUserSample
  // lançar antes do collector.stop('done') normal. .stop() é idempotente (chamar de novo
  // onde já corre não faz mal); isto só cobre a saída que faltava. Tipo minimo em vez do
  // ReturnType real (que é uma UNIÃO de todos os componentType possíveis e não estreita
  // bem para o Button específico usado aqui) — mesmo padrão do `ChildLike` em piperPool.ts.
  let collectorHandle: { stop(reason?: string): void } | undefined;
  try {
    // Botão "Parar já": para além do auto-stop (alvo de FALA ou relógio-teto), tanto o
    // invocador como o alvo podem terminar quando quiserem.
    const stopBtn = new ButtonBuilder()
      .setCustomId(`clonestop:${targetId}`)
      .setLabel(t('clone.stopBtn', locale))
      .setStyle(ButtonStyle.Danger)
      .setEmoji('⏹️');
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(stopBtn);
    // Destapa os ouvidos SÓ para esta janela (selfDeaf false), gravando apenas o alvo.
    connection.rejoin({ channelId, selfDeaf: false, selfMute: false });
    const msg = await i.editReply({
      content: isSelf
        ? t('clone.recording', locale, { target: seconds })
        : t('clone.recordingOther', locale, { who, target: seconds }),
      components: [row],
    });

    // Sinal de paragem manual: o coletor de botões liga-o; o recorder faz poll dele.
    let stopped = false;
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: maxWallMs + 5_000,
    });
    collectorHandle = collector;
    collector.on('collect', (btn) => {
      if (btn.user.id !== userId && btn.user.id !== targetId) {
        void btn.reply({ content: t('clone.stopNotYours', locale), flags: MessageFlags.Ephemeral });
        return;
      }
      stopped = true;
      void btn.deferUpdate();
      collector.stop('user');
    });

    // Feedback ao vivo com throttle (~2.5s) — ajuda quem grava a saber que precisa de
    // continuar a falar até ao alvo (a causa nº1 de amostras curtas de mais).
    let lastEdit = Date.now();
    const { pcm, voicedMs, diag } = await recordUserSample(connection, targetId, {
      targetVoicedMs,
      maxWallMs,
      shouldStop: () => stopped,
      onProgress: (ms) => {
        const now = Date.now();
        if (now - lastEdit < 2_500) return;
        lastEdit = now;
        void i
          .editReply({
            content: t('clone.recordingProgress', locale, {
              got: Math.round(ms / 1000),
              target: seconds,
            }),
            components: [row],
          })
          .catch(() => {});
      },
    });
    collector.stop('done');
    // DIAGNÓSTICO da causa de amostras curtas (evidência real > teoria): se framesSeen for
    // alto mas framesVoiced baixo, é o gate de RMS a comer o áudio (não o user a falar pouco).
    // rmsMedian vs threshold diz logo se o chão está mal calibrado para este mic/canal.
    log.info(
      `[clone] diag user=${userId} target=${targetId} voicedMs=${voicedMs} ` +
        `framesSeen=${diag.framesSeen} framesVoiced=${diag.framesVoiced} ` +
        `rms[min/med/max]=${diag.rmsMin}/${diag.rmsMedian}/${diag.rmsMax} ` +
        `threshold=${diag.threshold} rounds=${diag.rounds}`,
    );
    if (voicedMs < minMs) {
      await i.editReply({
        content: t('clone.tooShort', locale, {
          seconds: Math.round(voicedMs / 1000),
          min: Math.round(minMs / 1000),
          target: seconds,
        }),
        components: [],
      });
      return;
    }
    // Ficheiro VERSIONADO por timestamp: uma re-gravação é um path novo -> chave de cache
    // nova (cacheKey inclui o basename do ref) -> não se ouve a voz velha. Apaga a amostra
    // anterior a seguir (o ficheiro antigo deixa de ser referenciado). O clone é SEMPRE do
    // invocador (é ele que vai falar com esta voz), mesmo quando gravou a voz de outra pessoa.
    const stamp = Date.now();
    const prev = getClone(deps.db, userId);
    const outPath = join(dirname(deps.config.dbPath), 'voice-clones', `${userId}-${stamp}.wav`);
    await pcmToWavFile(pcm, outPath);
    // Cifra a amostra biométrica EM REPOUSO (ToS §5(c)). No-op sem CLONE_KEY (em claro).
    encryptSampleFileInPlace(outPath, deps.config.cloneKey);
    // targetId = a pessoa cuja voz foi gravada (o próprio num auto-clone). Fica registado
    // para que essa pessoa possa revogar o clone com /voice clone delete (Fase 2 compliance).
    saveClone(deps.db, userId, outPath, stamp, targetId);
    if (prev && prev.samplePath !== outPath) {
      try {
        unlinkSync(prev.samplePath);
      } catch {
        // ficheiro antigo já removido — inofensivo
      }
    }
    await i.editReply({
      content: isSelf
        ? t('clone.saved', locale, { seconds: Math.round(voicedMs / 1000) })
        : t('clone.savedOther', locale, { seconds: Math.round(voicedMs / 1000), who }),
      components: [],
    });
  } catch (err) {
    log.error('[clone] gravação falhou:', err);
    await i.editReply({ content: t('clone.failed', locale), components: [] }).catch(() => {});
  } finally {
    collectorHandle?.stop('finally');
    // Volta SEMPRE a ensurdecer (privacidade por defeito), aconteça o que acontecer.
    try {
      connection.rejoin({ channelId, selfDeaf: true, selfMute: false });
    } catch {
      // ligação pode ter morrido entretanto — inofensivo
    }
    activeCloneRecordings.delete(targetId);
  }
}

export async function handleVoice(i: ChatInputCommandInteraction, deps: BotDeps): Promise<void> {
  const locale = localeForUser(deps, i);
  // Grupo /voice clone despacha para o handler próprio (getSubcommand() devolveria o
  // sub DENTRO do grupo e colidiria com os nomes de topo).
  if (i.options.getSubcommandGroup(false) === 'clone') {
    await handleVoiceClone(i, deps, locale);
    return;
  }
  const sub = i.options.getSubcommand();
  if (sub === 'set') {
    const model = i.options.getString('model', true);
    if (!deps.availableModels.includes(model)) {
      await reply(i, t('voice.unknownModel', locale));
      return;
    }
    // Guard beginner-friendly de intervalo: o builder do `speed` NAO tem min/max, por
    // isso o Discord NAO rejeita client-side (ex. speed:5). Antes fazia-se silent-clamp
    // (5 -> 2×) e respondia-se "sucesso" — uma surpresa silenciosa. So valida quando o
    // valor FOI fornecido (getNumber devolve null se omitido) E cai FORA de 0.5–2.0;
    // nesse caso erro amigavel com o intervalo e NADA gravado (rejeicao, nao clamp).
    // Boundaries 0.5 e 2.0 continuam validos. Omitido -> cai no defaultSpeed (inalterado).
    const rawSpeed = i.options.getNumber('speed');
    if (rawSpeed !== null && (rawSpeed < 0.5 || rawSpeed > 2.0)) {
      await reply(i, t('voice.badSpeed', locale));
      return;
    }
    const speed = rawSpeed ?? deps.config.defaultSpeed;
    // Clamp preservado: no-op para valores fornecidos validos (ja em [0.5,2.0]); mantem
    // o comportamento antigo para o caminho omitido->defaultSpeed.
    const clamped = Math.min(2.0, Math.max(0.5, speed));
    // Motor por-utilizador: opção nova (google/piper/kokoro/gcloud). Se OMITIDA, PRESERVA
    // o motor atual do user — senão mudar só a voz reporia o motor para Google (read-first).
    const engineOpt = i.options.getString('engine') as
      'google' | 'piper' | 'kokoro' | 'gcloud' | null;
    const currentEngine = getUserVoice(deps.db, i.guildId!, i.user.id)?.engine ?? 'google';
    const engine = engineOpt ?? currentEngine;
    // GATE Premium: o motor Google HD (gcloud) exige Vozen Plus (user) OU Premium do
    // servidor. Só aqui, ao GUARDAR — em runtime o resolveUserEngine revalida (Premium
    // expirado -> gTTS). Mesmo padrão dos efeitos premium (voice.effect.locked).
    if (engine === 'gcloud') {
      const now = Date.now();
      const unlocked =
        isUserPremium(deps.db, i.user.id, now) || isGuildPremium(deps.db, i.guildId!, now);
      if (!unlocked) {
        await reply(i, t('voice.engine.gcloudLocked', locale));
        return;
      }
    }
    setUserVoice(deps.db, i.guildId!, i.user.id, model, clamped, engine);
    // Copy beginner-friendly: nome da voz NA LÍNGUA DO UTILIZADOR (i.locale) + id cru
    // copy-pasteável. Inclui o motor escolhido.
    await reply(
      i,
      t('voice.set', locale, {
        name: makeLocalizedNamer(i.locale, deps.availableModels)(model),
        model,
        speed: clamped,
        engine:
          engine === 'piper'
            ? 'Piper'
            : engine === 'kokoro'
              ? 'Kokoro'
              : engine === 'gcloud'
                ? 'Google HD'
                : 'Google',
      }),
    );
  } else if (sub === 'list') {
    // Beginner-friendly: em vez de uma lista plana de ids Piper, agrupa por lingua
    // com nomes humanos (formatVoiceList). O id cru fica entre parenteses para
    // /voice set continuar copy-pasteavel. Cabeçalhos das línguas NA LÍNGUA DO
    // UTILIZADOR (i.locale); cabeçalho da mensagem i18n.
    const list = deps.availableModels.length
      ? formatVoiceList(deps.availableModels, i.locale)
      : t('voice.listEmpty', locale);
    // Cartão: cabe bem nos 4096 chars da descrição de um embed (grupos por língua).
    const embed = brandEmbed().setDescription(`${t('voice.listHeader', locale)}\n${list}`);
    await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } else if (sub === 'reset') {
    resetUserVoice(deps.db, i.guildId!, i.user.id);
    await reply(i, t('voice.reset', locale));
  } else if (sub === 'optout') {
    // Por-utilizador (sem gate de admin): cada um gere o seu opt-out da auto-leitura.
    setOptOut(deps.db, i.guildId!, i.user.id);
    await reply(i, t('voice.optout', locale));
  } else if (sub === 'optin') {
    setOptIn(deps.db, i.guildId!, i.user.id);
    await reply(i, t('voice.optin', locale));
  } else if (sub === 'nickname') {
    // Apelido FONETICO para o xsaid. Vazio/omitido -> limpa (volta ao nome do servidor).
    const raw = i.options.getString('name');
    if (raw === null || raw.trim() === '') {
      clearNickname(deps.db, i.guildId!, i.user.id);
      await reply(i, t('voice.nickname.cleared', locale));
    } else {
      // Guarda JA sanitizado (tira emojis/simbolos); se nada legivel sobra, recusa.
      const clean = sanitizeSpeakerName(raw);
      if (!clean) {
        await reply(i, t('voice.nickname.invalid', locale));
        return;
      }
      setNickname(deps.db, i.guildId!, i.user.id, clean);
      await reply(i, t('voice.nickname.set', locale, { name: clean }));
    }
  } else if (sub === 'effect') {
    const raw = i.options.getString('effect', true);
    const effect: VoiceEffect = isVoiceEffect(raw) ? raw : 'none';
    // GATE premium: efeitos premium exigem Vozen Premium (servidor) OU Vozen Plus (user).
    // Só aqui, ao GUARDAR — o player aplica cegamente o que estiver guardado.
    if (isPremiumEffect(effect)) {
      const now = Date.now();
      const unlocked =
        isGuildPremium(deps.db, i.guildId!, now) || isUserPremium(deps.db, i.user.id, now);
      if (!unlocked) {
        await reply(i, t('voice.effect.locked', locale, { effect: effectLabel(effect) }));
        return;
      }
    }
    setVoiceEffect(deps.db, i.guildId!, i.user.id, effect);
    await reply(
      i,
      effect === 'none'
        ? t('voice.effect.cleared', locale)
        : t('voice.effect.set', locale, { effect: effectLabel(effect) }),
    );
  } else if (sub === 'preview') {
    const SAMPLE = t('preview.sample', locale);
    const explicitModel = i.options.getString('model');

    // Valida o model explícito ANTES de verificar o player.
    if (explicitModel !== null && !deps.availableModels.includes(explicitModel)) {
      await reply(i, t('voice.unknownModel', locale));
      return;
    }

    const player = getPlayer(deps, i.guildId!);
    if (!player) {
      await reply(i, t('voice.notInVoice', locale));
      return;
    }

    const cfg = getGuildConfig(deps.db, i.guildId!);

    // rate-limit por-utilizador (MESMO limiter do /tts e /laugh — ABUSE-03): sem isto
    // o preview enfileirava sem limite -> monopolizava a fila de voz (1 worker por
    // guild) e forçava sinteses cache-miss ao ciclar a opcao `model:`. Mesmo padrao
    // do handleLaugh em fun.ts.
    const rl = getLimiter(deps, i.guildId!, cfg.ratePerMin);
    if (!rl.allow(i.user.id, Date.now())) {
      await reply(i, t('tts.tooFast', locale));
      return;
    }

    const stored = getUserVoice(deps.db, i.guildId!, i.user.id);
    // Preview NAO passa por resolveSynth de proposito: resolveSynth agora deixa a
    // LINGUA da mensagem decidir a voz, mas o /voice preview e um DEMO de UMA voz
    // especifica — tem de tocar exatamente o model pedido (ou o guardado/default),
    // independentemente da lingua da frase-amostra. Por isso construimos o
    // SynthRequest diretamente. Precedencia: model explicito > voz guardada do
    // user > default_voice da guild > .env > amy. Velocidade: a do user, senao a default.
    const model =
      (explicitModel ?? stored?.model) ||
      cfg.defaultVoice ||
      deps.config.defaultVoice ||
      'en_US-amy-medium';
    const speed = stored?.speed ?? deps.config.defaultSpeed;
    // singleVoice: o preview e um DEMO de UMA voz especifica; a deteccao nunca deve
    // sobrepor-se nem partir a frase-amostra por lingua. O motor e o do user (o preview
    // tem de soar ao que ele vai ouvir de facto).
    const req: SynthRequest = {
      text: SAMPLE,
      model,
      speed,
      singleVoice: true,
      // o preview tem de soar ao que o user vai ouvir; o resolver aplica o gate gcloud
      // (->google sem Premium) e o orçamento (Fase 3) — engine + gcloudBudget.
      ...resolveUserEngine(deps.db, i.guildId!, i.user.id, stored?.engine, Date.now()),
    };
    // say() devolve false quando a fila esta no cap: nesse caso NAO mentir "a
    // reproduzir" — reutilizamos a mesma chave tts.busy do /tts (consistencia).
    const queued = await player.say(req);
    await reply(i, queued ? t('voice.previewPlaying', locale) : t('tts.busy', locale));
  }
}
