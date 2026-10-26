# # Apple Health Analytics & AI Coach Dashboard - Project Guide

## Overview

A high-end, iOS-styled modern web dashboard designed to display Apple Health metrics received via manual XML upload or free iOS Shortcuts Webhook. 

The app analyzes heart rate (resting & workout), sleep stages, breathing rate, active vs. inactive days/times, performance trends over time, and includes an AI Performance Coach.

## Tech Stack

- **Framework**: Next.js 15 (App Router, TypeScript)

- **Styling**: Tailwind CSS (Apple Minimalist / iOS Dark & Light Mode aesthetic with glassmorphism)

- **UI Components**: Shadcn UI, Lucide Icons, Framer Motion

- **Charts**: Recharts

- **Database**: Supabase / PostgreSQL (Prisma ORM)

- **AI Coach**: Vercel AI SDK with OpenAI / Gemini API

## Architecture & Workflows

1. **Data Ingestion**:

   - **Option A (Manual Upload)**: User drops `export.xml` or custom JSON via UI `/upload`. Backend parses XML/JSON using fast stream parser `fast-xml-parser`) and saves to DB.

   - **Option B (Shortcut Webhook)**: POST `/api/health-ingest` receiving payload sent by native iOS Shortcuts app.

2. **Dashboard Features (iOS Aesthetic)**:

   - **Overview**: Resting HR, Sleep Score, Avg Sleep/Wake times, Daily Activity ring summaries.

   - **Heart & Breathing**: Resting vs. Workout HR over time, HRV, breathing rate trends.

   - **Sleep Architecture**: Deep, REM, Core breakdown, bedtime/wake-up consistency, average bedtime timestamp (e.g., 00:00).

   - **Activity & Workout Trends**: 

     - Workout comparison matrix (Run 1 vs Run 2).

     - Heatmap / charts for most active vs. least active hours and days.

     - Health Trend Indicator: Algorithmic assessment evaluating if performance/recovery is improving or declining.

   - **AI Coach**: Interactive AI personal trainer offering customized workout split recommendations (Running, Weights) based on actual metrics and fatigue.

## Code Conventions

- Use clean Server Actions / API routes for data fetching and parsing.

- Format all components with Apple iOS style `rounded-3xl`, subtle borders, frosted glass `backdrop-blur`).