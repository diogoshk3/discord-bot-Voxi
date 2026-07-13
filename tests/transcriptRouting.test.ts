import { describe, it, expect } from 'vitest';
import {
  cleanTranscriptText,
  isTranscribable,
  formatTranscript,
} from '../src/voice/transcriptRouting';

// Routing PURO do STT: do texto cru do Whisper até à mensagem de canal. Sem IO.
// - cleanTranscriptText: apara e colapsa espaços.
// - isTranscribable: decide se vale a pena postar (Whisper devolve "" em ruído/silêncio).
// - formatTranscript: "**Nome:** texto", neutralizando pings de massa no nome/texto.

describe('cleanTranscriptText', () => {
  it('apara e colapsa espaço interno', () => {
    expect(cleanTranscriptText('  olá    mundo  ')).toBe('olá mundo');
    expect(cleanTranscriptText('\n\ttexto\n')).toBe('texto');
  });
});

describe('isTranscribable', () => {
  it('vazio/espaço -> não posta (ruído do Whisper)', () => {
    expect(isTranscribable('')).toBe(false);
    expect(isTranscribable('   ')).toBe(false);
    expect(isTranscribable('\n')).toBe(false);
  });
  it('texto real -> posta', () => {
    expect(isTranscribable('hello there')).toBe(true);
  });
});

describe('formatTranscript', () => {
  it('formata "**Nome:** texto"', () => {
    expect(formatTranscript('Rita', 'good game')).toBe('**Rita:** good game');
  });
  it('neutraliza @everyone/@here vindos da fala ou do nome (defesa em profundidade)', () => {
    expect(formatTranscript('Rita', 'ping @everyone now')).not.toContain('@everyone');
    expect(formatTranscript('@here', 'oi')).not.toContain('@here');
  });
  it('apara o texto ao formatar', () => {
    expect(formatTranscript('Rita', '  hi  ')).toBe('**Rita:** hi');
  });
});
