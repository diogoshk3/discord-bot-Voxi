// tests/logger.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatLine, log } from '../src/logging/logger';

// ---------------------------------------------------------------------------
// 1. formatLine — pura, sem relógio real
// ---------------------------------------------------------------------------
describe('formatLine', () => {
  it('inclui timestamp ISO da data passada', () => {
    const d = new Date('2026-06-30T05:00:00.000Z');
    expect(formatLine(d, 'info', 'olá')).toContain('2026-06-30T05:00:00.000Z');
  });

  it('inclui nível em maiúsculas', () => {
    const d = new Date('2026-06-30T05:00:00.000Z');
    expect(formatLine(d, 'warn', 'x')).toContain('[WARN]');
    expect(formatLine(d, 'error', 'x')).toContain('[ERROR]');
    expect(formatLine(d, 'debug', 'x')).toContain('[DEBUG]');
    expect(formatLine(d, 'info', 'x')).toContain('[INFO]');
  });

  it('inclui a mensagem', () => {
    const d = new Date('2026-06-30T05:00:00.000Z');
    expect(formatLine(d, 'info', 'mensagem teste')).toContain('mensagem teste');
  });

  it('formato completo: <iso> [LEVEL] mensagem', () => {
    const d = new Date('2026-06-30T05:00:00.000Z');
    expect(formatLine(d, 'info', 'hello')).toBe('2026-06-30T05:00:00.000Z [INFO] hello');
  });
});

// ---------------------------------------------------------------------------
// 2. Filtragem por nível (lê process.env.LOG_LEVEL dinamicamente)
// ---------------------------------------------------------------------------
describe('log — filtragem por nível', () => {
  const saved = process.env.LOG_LEVEL;
  let spyLog: ReturnType<typeof vi.spyOn>;
  let spyErr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spyLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    spyErr = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (saved === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = saved;
  });

  it('debug é suprimido quando LOG_LEVEL=info (default)', () => {
    process.env.LOG_LEVEL = 'info';
    log.debug('nao deve aparecer');
    expect(spyLog).not.toHaveBeenCalled();
    expect(spyErr).not.toHaveBeenCalled();
  });

  it('debug é suprimido quando LOG_LEVEL não está definido (default=info)', () => {
    delete process.env.LOG_LEVEL;
    log.debug('silencioso');
    expect(spyLog).not.toHaveBeenCalled();
    expect(spyErr).not.toHaveBeenCalled();
  });

  it('info passa quando LOG_LEVEL=info', () => {
    process.env.LOG_LEVEL = 'info';
    log.info('mensagem info');
    expect(spyLog).toHaveBeenCalledOnce();
    expect(spyLog.mock.calls[0][0]).toContain('[INFO]');
    expect(spyLog.mock.calls[0][0]).toContain('mensagem info');
  });

  it('warn passa no default (LOG_LEVEL=info)', () => {
    process.env.LOG_LEVEL = 'info';
    log.warn('aviso');
    expect(spyErr).toHaveBeenCalledOnce();
    expect(spyErr.mock.calls[0][0]).toContain('[WARN]');
  });

  it('error passa no default', () => {
    process.env.LOG_LEVEL = 'info';
    log.error('erro');
    expect(spyErr).toHaveBeenCalledOnce();
    expect(spyErr.mock.calls[0][0]).toContain('[ERROR]');
  });

  it('debug aparece quando LOG_LEVEL=debug', () => {
    process.env.LOG_LEVEL = 'debug';
    log.debug('debug visivel');
    expect(spyLog).toHaveBeenCalledOnce();
    expect(spyLog.mock.calls[0][0]).toContain('[DEBUG]');
  });

  it('info é suprimido quando LOG_LEVEL=warn', () => {
    process.env.LOG_LEVEL = 'warn';
    log.info('info silencioso');
    expect(spyLog).not.toHaveBeenCalled();
  });

  it('warn passa quando LOG_LEVEL=warn', () => {
    process.env.LOG_LEVEL = 'warn';
    log.warn('aviso visivel');
    expect(spyErr).toHaveBeenCalledOnce();
  });

  it('error passa mesmo quando LOG_LEVEL=warn', () => {
    process.env.LOG_LEVEL = 'warn';
    log.error('erro visivel');
    expect(spyErr).toHaveBeenCalledOnce();
  });

  it('valor LOG_LEVEL inválido cai em info (debug suprimido)', () => {
    process.env.LOG_LEVEL = 'bogus';
    log.debug('silencioso');
    expect(spyLog).not.toHaveBeenCalled();
    log.info('visivel');
    expect(spyLog).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 3. warn e error escrevem para console.error; debug e info para console.log
// ---------------------------------------------------------------------------
describe('log — sink correto', () => {
  const saved = process.env.LOG_LEVEL;
  let spyLog: ReturnType<typeof vi.spyOn>;
  let spyErr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.LOG_LEVEL = 'debug'; // ver tudo
    spyLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    spyErr = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (saved === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = saved;
  });

  it('debug → console.log', () => {
    log.debug('d');
    expect(spyLog).toHaveBeenCalledOnce();
    expect(spyErr).not.toHaveBeenCalled();
  });

  it('info → console.log', () => {
    log.info('i');
    expect(spyLog).toHaveBeenCalledOnce();
    expect(spyErr).not.toHaveBeenCalled();
  });

  it('warn → console.error', () => {
    log.warn('w');
    expect(spyErr).toHaveBeenCalledOnce();
    expect(spyLog).not.toHaveBeenCalled();
  });

  it('error → console.error', () => {
    log.error('e');
    expect(spyErr).toHaveBeenCalledOnce();
    expect(spyLog).not.toHaveBeenCalled();
  });

  it('passa argumentos extra ao sink (para stack traces)', () => {
    const err = new Error('boom');
    log.error('detalhe', err);
    expect(spyErr).toHaveBeenCalledOnce();
    // primeiro arg é a linha formatada, segundo é o Error
    expect(spyErr.mock.calls[0][1]).toBe(err);
  });

  it('log.warn passa args extra', () => {
    const obj = { x: 1 };
    log.warn('detalhe', obj);
    expect(spyErr.mock.calls[0][1]).toBe(obj);
  });
});
