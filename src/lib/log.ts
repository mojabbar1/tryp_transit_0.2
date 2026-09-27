/**
 * JSON-line logger for server code. Log reason codes and ids, never raw LLM text at info level,
 * never secrets, and never key-presence flags.
 */

type Level = 'info' | 'warn' | 'error';

export interface LogFields {
  requestId?: string;
  durationMs?: number;
  [field: string]: unknown;
}

function write(level: Level, msg: string, fields: LogFields = {}) {
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  info: (msg: string, fields?: LogFields) => write('info', msg, fields),
  warn: (msg: string, fields?: LogFields) => write('warn', msg, fields),
  error: (msg: string, fields?: LogFields) => write('error', msg, fields),
};
