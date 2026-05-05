import { pino, type Logger } from 'pino';
import { getEnv } from './env.js';

let _logger: Logger | undefined;

export function getLogger(): Logger {
  if (!_logger) {
    const env = getEnv();
    const baseOptions: { level: string; base: { service: string } } = {
      level: env.LOG_LEVEL,
      base: { service: 'flipturn-api' },
    };
    if (env.NODE_ENV === 'development') {
      _logger = pino({
        ...baseOptions,
        transport: { target: 'pino-pretty', options: { colorize: true } },
      });
    } else {
      _logger = pino(baseOptions);
    }
  }
  return _logger;
}
