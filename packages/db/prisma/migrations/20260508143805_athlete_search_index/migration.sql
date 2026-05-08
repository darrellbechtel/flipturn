CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- CreateEnum
CREATE TYPE "AthleteSource" AS ENUM ('USER_ONBOARDED', 'CRAWLED');

-- AlterTable
ALTER TABLE "Athlete" ADD COLUMN     "clubId" TEXT,
ADD COLUMN     "dobYear" INTEGER,
ADD COLUMN     "lastIndexedAt" TIMESTAMP(3),
ADD COLUMN     "source" "AthleteSource" NOT NULL DEFAULT 'USER_ONBOARDED';

-- CreateTable
CREATE TABLE "Club" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "province" TEXT,
    "city" TEXT,
    "rosterUrl" TEXT,
    "lastCrawledAt" TIMESTAMP(3),
    "crawlPriority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Club_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Club_province_idx" ON "Club"("province");

-- CreateIndex
CREATE INDEX "Club_name_idx" ON "Club"("name");

-- CreateIndex
CREATE INDEX "Club_crawlPriority_lastCrawledAt_idx" ON "Club"("crawlPriority", "lastCrawledAt");

-- CreateIndex
CREATE INDEX "Athlete_clubId_idx" ON "Athlete"("clubId");

-- CreateIndex
CREATE INDEX "Athlete_dobYear_idx" ON "Athlete"("dobYear");

-- AddForeignKey
ALTER TABLE "Athlete" ADD CONSTRAINT "Athlete_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- IMMUTABLE wrappers needed for the searchVector generated column.
-- Postgres ships unaccent() and array_to_string() as STABLE, which forbids them in
-- generated-column expressions. We pin unaccent() to the default 'unaccent' dictionary
-- (the only one we use) and wrap array_to_string() over text[]/text — both are
-- effectively deterministic for our inputs, so it's safe to mark them IMMUTABLE.
-- See https://dba.stackexchange.com/a/268822 for the canonical pattern.
CREATE OR REPLACE FUNCTION f_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;

CREATE OR REPLACE FUNCTION f_array_to_string(text[], text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
AS $$ SELECT array_to_string($1, $2) $$;

-- Add tsvector generated column for full-text search over primaryName + alternateNames.
-- Not represented in schema.prisma; managed via raw SQL only.
ALTER TABLE "Athlete"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'simple'::regconfig,
      f_unaccent(
        coalesce("primaryName", '') || ' ' ||
        coalesce(f_array_to_string("alternateNames", ' '), '')
      )
    )
  ) STORED;

CREATE INDEX "Athlete_searchVector_idx" ON "Athlete" USING GIN ("searchVector");
CREATE INDEX "Athlete_primaryName_trgm_idx" ON "Athlete" USING GIN ("primaryName" gin_trgm_ops);
