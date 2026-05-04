import { PrismaClient } from '@prisma/client';

export { PrismaClient };
export * from '@prisma/client';

let _client: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!_client) {
    _client = new PrismaClient();
  }
  return _client;
}

export async function disconnectPrisma(): Promise<void> {
  if (_client) {
    await _client.$disconnect();
    _client = undefined;
  }
}
