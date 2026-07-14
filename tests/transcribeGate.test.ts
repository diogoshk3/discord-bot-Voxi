import { describe, it, expect } from 'vitest';
import {
  evaluateTranscribeStart,
  shouldAutoStop,
  resolveTranscribeLang,
} from '../src/commands/transcribeGate';

// Gates PUROS do /transcribe (Fase 4). Decidem SEM IO se a transcrição pode arrancar e
// quando deve auto-parar — o handler só traduz o veredito em resposta/ação.

describe('evaluateTranscribeStart', () => {
  const ok = {
    canManage: true,
    isPremium: true,
    sidecarAvailable: true,
    botInVoice: true,
    alreadyRunning: false,
    atCapacity: false,
  };

  it('tudo verde -> ok', () => {
    expect(evaluateTranscribeStart(ok)).toBe('ok');
  });

  it('sem Manage-Guild -> noManage (authz primeiro)', () => {
    expect(evaluateTranscribeStart({ ...ok, canManage: false })).toBe('noManage');
  });

  it('sem Premium -> notPremium', () => {
    expect(evaluateTranscribeStart({ ...ok, isPremium: false })).toBe('notPremium');
  });

  it('sidecar não instalado -> unavailable', () => {
    expect(evaluateTranscribeStart({ ...ok, sidecarAvailable: false })).toBe('unavailable');
  });

  it('bot fora da call -> notInVoice', () => {
    expect(evaluateTranscribeStart({ ...ok, botInVoice: false })).toBe('notInVoice');
  });

  it('já a correr -> alreadyRunning', () => {
    expect(evaluateTranscribeStart({ ...ok, alreadyRunning: true })).toBe('alreadyRunning');
  });

  it('authz vence entitlement: sem Manage E sem Premium -> noManage', () => {
    expect(evaluateTranscribeStart({ ...ok, canManage: false, isPremium: false })).toBe('noManage');
  });

  // Plano 029 (ABUSE-01): cap GLOBAL de sessões STT concorrentes (todas as guilds,
  // processo inteiro) — sem isto, N guilds Premium a transcrever ao mesmo tempo
  // multiplicam cópias do modelo Whisper em RAM e podem fazer OOM ao processo inteiro.
  it('cap global atingido -> atCapacity', () => {
    expect(evaluateTranscribeStart({ ...ok, atCapacity: true })).toBe('atCapacity');
  });

  it('já a correr NESTA guild vence atCapacity: estado por-guild é mais específico que o global', () => {
    expect(evaluateTranscribeStart({ ...ok, alreadyRunning: true, atCapacity: true })).toBe(
      'alreadyRunning',
    );
  });

  it('atCapacity só dispara depois de authz/entitlement/disponibilidade/voz passarem', () => {
    expect(evaluateTranscribeStart({ ...ok, canManage: false, atCapacity: true })).toBe('noManage');
    expect(evaluateTranscribeStart({ ...ok, isPremium: false, atCapacity: true })).toBe(
      'notPremium',
    );
    expect(evaluateTranscribeStart({ ...ok, sidecarAvailable: false, atCapacity: true })).toBe(
      'unavailable',
    );
    expect(evaluateTranscribeStart({ ...ok, botInVoice: false, atCapacity: true })).toBe(
      'notInVoice',
    );
  });
});

describe('shouldAutoStop', () => {
  const consented = (id: string) => id === 'a' || id === 'b';

  it('não arma antes de alguém consentir (evita insta-stop no arranque)', () => {
    expect(shouldAutoStop(['x', 'y'], consented, false)).toBe(false);
  });

  it('depois de haver consentimento: pára quando não resta ninguém consentido na call', () => {
    expect(shouldAutoStop(['x', 'y'], consented, true)).toBe(true);
  });

  it('depois de haver consentimento: continua enquanto um consentido estiver na call', () => {
    expect(shouldAutoStop(['a', 'x'], consented, true)).toBe(false);
  });

  it('call vazia de humanos -> pára (mesmo que ninguém tenha consentido ainda)', () => {
    expect(shouldAutoStop([], consented, false)).toBe(true);
  });
});

describe('resolveTranscribeLang', () => {
  it('a língua escolhida no comando ganha ao locale do servidor', () => {
    expect(resolveTranscribeLang('en', 'pt')).toBe('en');
  });
  it('sem escolha (null/vazio) cai no locale do servidor', () => {
    expect(resolveTranscribeLang(null, 'pt')).toBe('pt');
    expect(resolveTranscribeLang('', 'pt')).toBe('pt');
    expect(resolveTranscribeLang('  ', 'pt')).toBe('pt');
  });
  it('apara e normaliza para minúsculas (código de língua limpo)', () => {
    expect(resolveTranscribeLang(' EN ', 'pt')).toBe('en');
  });
});
