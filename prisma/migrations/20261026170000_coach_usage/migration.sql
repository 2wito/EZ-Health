-- CreateTable
CREATE TABLE "CoachUsage" (
    "visitor" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CoachUsage_pkey" PRIMARY KEY ("visitor","day")
);
