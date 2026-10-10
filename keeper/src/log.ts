import { pino, type Logger } from 'pino';

/** Structured JSON logs (pino). Secrets are never logged: config errors list names only. */
export function createLogger(level: string): Logger {
  return pino({ level, base: { svc: 'floor-keeper' } });
}
