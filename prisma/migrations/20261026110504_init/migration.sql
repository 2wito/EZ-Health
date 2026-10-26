-- CreateEnum
CREATE TYPE "MetricType" AS ENUM ('HEART_RATE', 'RESTING_HEART_RATE', 'WALKING_HEART_RATE_AVG', 'HEART_RATE_VARIABILITY', 'RESPIRATORY_RATE', 'ACTIVE_ENERGY', 'BASAL_ENERGY', 'STEP_COUNT', 'EXERCISE_TIME', 'VO2_MAX', 'BLOOD_OXYGEN');

-- CreateEnum
CREATE TYPE "SleepStageType" AS ENUM ('IN_BED', 'AWAKE', 'ASLEEP', 'CORE', 'DEEP', 'REM');

-- CreateTable
CREATE TABLE "MetricSample" (
    "id" TEXT NOT NULL,
    "type" "MetricType" NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL,
    "tzOffsetMin" INTEGER NOT NULL DEFAULT 0,
    "localDate" DATE NOT NULL,
    "localHour" SMALLINT NOT NULL,
    "localWeekday" SMALLINT NOT NULL,
    "qty" DOUBLE PRECISION,
    "min" DOUBLE PRECISION,
    "avg" DOUBLE PRECISION,
    "max" DOUBLE PRECISION,
    "unit" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SleepSession" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "tzOffsetMin" INTEGER NOT NULL DEFAULT 0,
    "sleepStart" TIMESTAMPTZ(3),
    "sleepEnd" TIMESTAMPTZ(3),
    "inBedStart" TIMESTAMPTZ(3),
    "inBedEnd" TIMESTAMPTZ(3),
    "inBedHours" DOUBLE PRECISION,
    "totalSleep" DOUBLE PRECISION NOT NULL,
    "coreHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deepHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "awakeHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "asleepHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SleepSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SleepStage" (
    "id" TEXT NOT NULL,
    "stage" "SleepStageType" NOT NULL,
    "start" TIMESTAMPTZ(3) NOT NULL,
    "end" TIMESTAMPTZ(3) NOT NULL,
    "tzOffsetMin" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT '',
    "sessionId" TEXT,

    CONSTRAINT "SleepStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workout" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "start" TIMESTAMPTZ(3) NOT NULL,
    "end" TIMESTAMPTZ(3) NOT NULL,
    "tzOffsetMin" INTEGER NOT NULL DEFAULT 0,
    "localDate" DATE NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "activeEnergyKcal" DOUBLE PRECISION,
    "distanceKm" DOUBLE PRECISION,
    "avgSpeedKmh" DOUBLE PRECISION,
    "elevationUpM" DOUBLE PRECISION,
    "stepCount" DOUBLE PRECISION,
    "intensityMet" DOUBLE PRECISION,
    "avgHr" DOUBLE PRECISION,
    "minHr" DOUBLE PRECISION,
    "maxHr" DOUBLE PRECISION,
    "hrSeries" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestLog" (
    "id" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "metricsReceived" INTEGER NOT NULL DEFAULT 0,
    "samplesUpserted" INTEGER NOT NULL DEFAULT 0,
    "sleepNights" INTEGER NOT NULL DEFAULT 0,
    "workoutsUpserted" INTEGER NOT NULL DEFAULT 0,
    "skippedMetrics" TEXT[],
    "error" TEXT,
    "durationMs" INTEGER,

    CONSTRAINT "IngestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetricSample_type_localDate_idx" ON "MetricSample"("type", "localDate");

-- CreateIndex
CREATE INDEX "MetricSample_type_localWeekday_localHour_idx" ON "MetricSample"("type", "localWeekday", "localHour");

-- CreateIndex
CREATE UNIQUE INDEX "MetricSample_type_timestamp_source_key" ON "MetricSample"("type", "timestamp", "source");

-- CreateIndex
CREATE INDEX "SleepSession_date_idx" ON "SleepSession"("date");

-- CreateIndex
CREATE UNIQUE INDEX "SleepSession_date_source_key" ON "SleepSession"("date", "source");

-- CreateIndex
CREATE INDEX "SleepStage_start_idx" ON "SleepStage"("start");

-- CreateIndex
CREATE INDEX "SleepStage_sessionId_idx" ON "SleepStage"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SleepStage_stage_start_source_key" ON "SleepStage"("stage", "start", "source");

-- CreateIndex
CREATE INDEX "Workout_localDate_idx" ON "Workout"("localDate");

-- CreateIndex
CREATE INDEX "Workout_name_start_idx" ON "Workout"("name", "start");

-- CreateIndex
CREATE UNIQUE INDEX "Workout_name_start_key" ON "Workout"("name", "start");

-- AddForeignKey
ALTER TABLE "SleepStage" ADD CONSTRAINT "SleepStage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SleepSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
