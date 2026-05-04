import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Demo athlete 1 — for local dev only; SNC IDs are placeholders.
  const sarah = await prisma.athlete.upsert({
    where: { sncId: 'DEMO-SARAH-001' },
    update: {},
    create: {
      sncId: 'DEMO-SARAH-001',
      primaryName: 'Sarah Demo',
      alternateNames: ['Sarah D.', 'S. Demo'],
      gender: 'F',
      homeClub: 'Waterloo Region Aquatics',
    },
  });

  const benji = await prisma.athlete.upsert({
    where: { sncId: 'DEMO-BENJI-002' },
    update: {},
    create: {
      sncId: 'DEMO-BENJI-002',
      primaryName: 'Benji Demo',
      gender: 'M',
      homeClub: 'Waterloo Region Aquatics',
    },
  });

  // Demo meet — local-dev only.
  const meet = await prisma.meet.upsert({
    where: { externalId: 'DEMO-MEET-001' },
    update: {},
    create: {
      externalId: 'DEMO-MEET-001',
      name: 'Demo Spring Open 2026',
      sanctionBody: 'SNC',
      course: 'LCM',
      location: 'Waterloo, ON',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-03'),
    },
  });

  console.log(`Seeded athletes: ${sarah.id}, ${benji.id}; meet: ${meet.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
