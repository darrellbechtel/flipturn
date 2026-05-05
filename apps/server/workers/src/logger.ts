import { pino, type Logger, type LoggerOptions } from 'pino';
import { getEnv } from './env.js';

let _logger: Logger | undefined;

export function getLogger(): Logger {
  if (!_logger) {
    const env = getEnv();
    const options: LoggerOptions = {
      level: env.LOG_LEVEL,
      base: { service: 'flipturn-workers' },
    };
    if (env.NODE_ENV === 'development') {
      options.transport = { target: 'pino-pretty', options: { colorize: true } };
    }
    _logger = pino(options);
  }
  return _logger;
}
