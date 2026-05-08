-- AlterEnum
-- Adds the new value at the top so the rest of the migration cannot reference
-- it in the same transaction (Postgres allows ALTER TYPE ... ADD VALUE inside
-- a transaction as long as the new value isn't used until after commit).
ALTER TYPE "AthleteSource" ADD VALUE 'REMOTE_DISCOVERY';

-- DropIndex
DROP INDEX "Club_crawlPriority_lastCrawledAt_idx";

-- AlterTable
ALTER TABLE "Club" DROP COLUMN "crawlPriority";
