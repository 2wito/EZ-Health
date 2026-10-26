-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADING', 'QUEUED', 'READING', 'SAVING', 'DONE', 'FAILED');

-- DropIndex
DROP INDEX "Workout_name_start_key";

-- AlterTable
ALTER TABLE "Workout" ADD COLUMN     "source" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "DailyActivity" (
    "date" DATE NOT NULL,
    "activeEnergyKcal" DOUBLE PRECISION,
    "activeEnergyGoal" DOUBLE PRECISION,
    "exerciseMin" DOUBLE PRECISION,
    "exerciseGoalMin" DOUBLE PRECISION,
    "standHours" DOUBLE PRECISION,
    "standGoalHours" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyActivity_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADING',
    "fileName" TEXT NOT NULL,
    "fileBytes" BIGINT NOT NULL DEFAULT 0,
    "bytesRead" BIGINT NOT NULL DEFAULT 0,
    "bytesTotal" BIGINT NOT NULL DEFAULT 0,
    "recordsRead" INTEGER NOT NULL DEFAULT 0,
    "samplesSaved" INTEGER NOT NULL DEFAULT 0,
    "sleepNights" INTEGER NOT NULL DEFAULT 0,
    "workoutsSaved" INTEGER NOT NULL DEFAULT 0,
    "activityDays" INTEGER NOT NULL DEFAULT 0,
    "recordsSkipped" INTEGER NOT NULL DEFAULT 0,
    "parseWarnings" INTEGER NOT NULL DEFAULT 0,
    "dataFrom" TIMESTAMPTZ(3),
    "dataTo" TIMESTAMPTZ(3),
    "error" TEXT,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportJob_createdAt_idx" ON "ImportJob"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Workout_start_key" ON "Workout"("start");

