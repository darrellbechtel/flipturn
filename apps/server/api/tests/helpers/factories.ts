import type { PrismaClient } from '@flipturn/db';
import { generateSessionToken, hashToken } from '../../src/auth.js';

export async function makeUser(prisma: PrismaClient, email = 'parent@example.com') {
  return prisma.user.create({ data: { email } });
}

export async function makeSession(prisma: PrismaClient, userId: string) {
  const token = generateSessionToken();
  const session = await prisma.session.create({
    data: { userId, tokenHash: hashToken(token) },
  });
  return { token, session };
}

export async function makeAthleteForUser(
  prisma: PrismaClient,
  userId: string,
  sncId: string,
  primaryName: string,
) {
  const athlete = await prisma.athlete.create({
    data: { sncId, primaryName },
  });
  await prisma.userAthlete.create({
    data: { userId, athleteId: athlete.id, relationship: 'PARENT' },
  });
  return athlete;
}
