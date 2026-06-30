// src/logging/logger.ts
//
// Logger central com niveis e timestamps.
// Lê LOG_LEVEL de process.env directamente (sem depender de AppConfig) para
// evitar dependência circular.  Niveis: debug < info < warn < error.
// Default: info.  Valor inválido → info.

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Formata uma linha de log — pura, sem efeitos secundários, testável. */
export function formatLine(now: Date, level: LogLevel, message: string): string {
  return `${now.toISOString()} [${level.toUpperCase()}] ${message}`;
}

/** Resolve o nível mínimo a partir da env (dinamicamente por chamada). */
function resolveMinLevel(): number {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase() as LogLevel | undefined;
  return LEVEL_RANK[raw as LogLevel] ?? LEVEL_RANK.info;
}

/** Devolve true se a mensagem com este nível deve ser emitida. */
function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= resolveMinLevel();
}

function emit(level: LogLevel, message: string, ...rest: unknown[]): void {
  if (!shouldLog(level)) return;
  const line = formatLine(new Date(), level, message);
  if (level === 'error' || level === 'warn') {
    console.error(line, ...rest);
  } else {
    console.log(line, ...rest);
  }
}

export const log = {
  debug(message: string, ...rest: unknown[]): void {
    emit('debug', message, ...rest);
  },
  info(message: string, ...rest: unknown[]): void {
    emit('info', message, ...rest);
  },
  warn(message: string, ...rest: unknown[]): void {
    emit('warn', message, ...rest);
  },
  error(message: string, ...rest: unknown[]): void {
    emit('error', message, ...rest);
  },
};
