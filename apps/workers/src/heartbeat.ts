import { getRedis } from './redis.js';
import { getLogger } from './logger.js';

const HEARTBEAT_KEY = 'workers:heartbeat';
const TTL_SECONDS = 90; // beat every 60s, alert if older than 90s

let _interval: NodeJS.Timeout | undefined;

export function startHeartbeat(): void {
  if (_interval) return;
  const tick = async () => {
    try {
      await getRedis().set(HEARTBEAT_KEY, Date.now().toString(), 'EX', TTL_SECONDS);
    } catch (err) {
      getLogger().error({ err }, 'heartbeat write failed');
    }
  };
  void tick();
  _interval = setInterval(tick, 60_000);
}

export function stopHeartbeat(): void {
  if (_interval) {
    clearInterval(_interval);
    _interval = undefined;
  }
}
