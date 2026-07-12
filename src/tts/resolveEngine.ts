// src/tts/resolveEngine.ts
//
// Resolvedor PARTILHADO do motor efetivo de um pedido, chamado em TODOS os ~sítios que
// copiam a escolha de motor do utilizador (userVoice.engine) para um SynthRequest:
// messageHandler (leitura de mensagens), /joke, /laugh, /voice preview, e o resto.
//
// Porquê partilhado: o motor 'gcloud' (Google HD) é um perk PAGO. Um gate só num sítio
// (ex. só na leitura de mensagens) seria um BURACO de custo — o /joke, /laugh, etc.
// passariam ao lado e gastariam a API da Google sem Premium nem contagem. Este ponto
// único garante COBERTURA: aqui despromovemos 'gcloud'->'google' quando o Premium não
// está ativo (gate runtime), e (Fase 3) resolvemos o descritor de orçamento que viaja no
// pedido até ao chokepoint (GCloudEngine), onde os chars são contados.
//
// Fase 2 (agora): só o GATE. Fase 3: preenche `gcloudBudget`.

import type Database from 'better-sqlite3';
import type { UserEngine } from '../store/userVoice';
import type { SynthRequest } from './engine';
import { isGuildPremium, isUserPremium, resolveGuildPassOwner } from '../store/premium';

export interface ResolvedEngine {
  /** Motor efetivo a usar (pode ser despromovido de 'gcloud' para 'google'). */
  engine: UserEngine | undefined;
  /** Descritor de orçamento a anexar ao pedido (só quando engine efetivo é 'gcloud'). */
  gcloudBudget?: SynthRequest['gcloudBudget'];
}

/**
 * Resolve o motor efetivo para (guild, user). Motores não-gcloud passam intactos (sem
 * sequer tocar no premium). Para 'gcloud', exige Vozen Plus (user) OU Premium do servidor
 * (guild) — sem isso, despromove a 'google' (o pedido sai em gTTS, sem custo). O
 * `storedEngine` é o motor GUARDADO do user (userVoice.engine); ausente => passa ausente.
 */
export function resolveUserEngine(
  db: Database.Database,
  guildId: string,
  userId: string,
  storedEngine: UserEngine | undefined,
  now: number,
): ResolvedEngine {
  if (storedEngine !== 'gcloud') return { engine: storedEngine };

  // Precedência dos pools (SEM spill — decidido 2026-07-12):
  //   1) tem Vozen Plus -> pool PESSOAL (scope 'user'). Esgotado -> gTTS; NÃO passa para o
  //      pool do passe (evita um Plus drenar o dono do passe).
  //   2) sem Plus, mas um PASSE ativo cobre a guild -> pool do PASSE (scope 'pass', keyed
  //      pelo dono, seats definem o tier). Partilhado entre os servidores do passe.
  //   3) sem Plus e sem passe, mas a guild é Premium DIRETO (redeem/discord/manual) ->
  //      pool do servidor (scope 'guild', keyed pelo guildId).
  //   4) nada disto -> gate: despromove a 'google' (gTTS, sem custo).
  if (isUserPremium(db, userId, now)) {
    return { engine: 'gcloud', gcloudBudget: { scope: 'user', key: userId } };
  }
  const passOwner = resolveGuildPassOwner(db, guildId, now);
  if (passOwner) {
    return {
      engine: 'gcloud',
      gcloudBudget: { scope: 'pass', key: passOwner.ownerId, seats: passOwner.seats },
    };
  }
  if (isGuildPremium(db, guildId, now)) {
    return { engine: 'gcloud', gcloudBudget: { scope: 'guild', key: guildId } };
  }
  return { engine: 'google' }; // gate: Premium perdido/ausente -> gTTS
}
