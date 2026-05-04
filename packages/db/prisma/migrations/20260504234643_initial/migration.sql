-- CreateEnum
CREATE TYPE "Relationship" AS ENUM ('PARENT', 'GUARDIAN', 'SELF', 'OTHER');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('M', 'F', 'X');

-- CreateEnum
CREATE TYPE "Course" AS ENUM ('SCM', 'LCM', 'SCY');

-- CreateEnum
CREATE TYPE "Stroke" AS ENUM ('FR', 'BK', 'BR', 'FL', 'IM');

-- CreateEnum
CREATE TYPE "Round" AS ENUM ('PRELIM', 'SEMI', 'FINAL', 'TIMED_FINAL');

-- CreateEnum
CREATE TYPE "SwimStatus" AS ENUM ('OFFICIAL', 'DQ', 'NS', 'DNF', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MagicLinkToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MagicLinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Athlete" (
    "id" TEXT NOT NULL,
    "sncId" TEXT NOT NULL,
    "primaryName" TEXT NOT NULL,
    "alternateNames" TEXT[],
    "dob" TIMESTAMP(3),
    "gender" "Gender",
    "homeClub" TEXT,
    "lastScrapedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Athlete_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAthlete" (
    "userId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "relationship" "Relationship" NOT NULL DEFAULT 'PARENT',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAthlete_pkey" PRIMARY KEY ("userId","athleteId")
);

-- CreateTable
CREATE TABLE "ClubMembership" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "clubName" TEXT NOT NULL,
    "clubCode" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),

    CONSTRAINT "ClubMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meet" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sanctionBody" TEXT,
    "course" "Course" NOT NULL,
    "location" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Meet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "meetId" TEXT NOT NULL,
    "distanceM" INTEGER NOT NULL,
    "stroke" "Stroke" NOT NULL,
    "gender" "Gender" NOT NULL,
    "ageBand" TEXT,
    "round" "Round" NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Swim" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "meetId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "timeCentiseconds" INTEGER NOT NULL,
    "splits" INTEGER[],
    "place" INTEGER,
    "status" "SwimStatus" NOT NULL DEFAULT 'OFFICIAL',
    "eventKey" TEXT NOT NULL,
    "dataSource" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersedesId" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Swim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalBest" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "swimId" TEXT NOT NULL,
    "timeCentiseconds" INTEGER NOT NULL,
    "achievedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalBest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "MagicLinkToken_tokenHash_key" ON "MagicLinkToken"("tokenHash");

-- CreateIndex
CREATE INDEX "MagicLinkToken_userId_idx" ON "MagicLinkToken"("userId");

-- CreateIndex
CREATE INDEX "MagicLinkToken_expiresAt_idx" ON "MagicLinkToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Athlete_sncId_key" ON "Athlete"("sncId");

-- CreateIndex
CREATE INDEX "UserAthlete_athleteId_idx" ON "UserAthlete"("athleteId");

-- CreateIndex
CREATE INDEX "ClubMembership_athleteId_idx" ON "ClubMembership"("athleteId");

-- CreateIndex
CREATE UNIQUE INDEX "Meet_externalId_key" ON "Meet"("externalId");

-- CreateIndex
CREATE INDEX "Event_meetId_idx" ON "Event"("meetId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_meetId_distanceM_stroke_gender_ageBand_round_key" ON "Event"("meetId", "distanceM", "stroke", "gender", "ageBand", "round");

-- CreateIndex
CREATE INDEX "Swim_athleteId_eventKey_idx" ON "Swim"("athleteId", "eventKey");

-- CreateIndex
CREATE INDEX "Swim_meetId_idx" ON "Swim"("meetId");

-- CreateIndex
CREATE UNIQUE INDEX "Swim_athleteId_meetId_eventId_key" ON "Swim"("athleteId", "meetId", "eventId");

-- CreateIndex
CREATE INDEX "PersonalBest_eventKey_idx" ON "PersonalBest"("eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalBest_athleteId_eventKey_key" ON "PersonalBest"("athleteId", "eventKey");

-- AddForeignKey
ALTER TABLE "MagicLinkToken" ADD CONSTRAINT "MagicLinkToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAthlete" ADD CONSTRAINT "UserAthlete_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAthlete" ADD CONSTRAINT "UserAthlete_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMembership" ADD CONSTRAINT "ClubMembership_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_meetId_fkey" FOREIGN KEY ("meetId") REFERENCES "Meet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Swim" ADD CONSTRAINT "Swim_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Swim" ADD CONSTRAINT "Swim_meetId_fkey" FOREIGN KEY ("meetId") REFERENCES "Meet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Swim" ADD CONSTRAINT "Swim_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Swim" ADD CONSTRAINT "Swim_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "Swim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalBest" ADD CONSTRAINT "PersonalBest_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalBest" ADD CONSTRAINT "PersonalBest_swimId_fkey" FOREIGN KEY ("swimId") REFERENCES "Swim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
