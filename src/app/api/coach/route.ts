import { convertToModelMessages, createUIMessageStreamResponse, streamText, toUIMessageStream, type UIMessage } from "ai";
import { NextResponse } from "next/server";
import { getCoachModel } from "@/lib/coach/model";
import { getCoachSnapshot, snapshotToBriefing } from "@/lib/coach/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Long chats cost more and add little; the briefing carries the data anyway.
const MAX_MESSAGES = 20;

const INSTRUCTIONS = `You are the performance coach inside EZ Health, a personal Apple Health dashboard.
You coach one person, using only the data briefing below. Today's date is the briefing's "as of" date.

How to coach:
- Be specific and practical. Cite the numbers you're using ("HRV 38 ms, 20% under your average").
- Readiness sets today's intensity. "Prioritize recovery": rest, walking, mobility or an easy zone 1-2 session only. "Train as planned": normal sessions, no max efforts. "Ready to push": intervals, tempo work or heavy lifting are fine.
- Running plans: build on recent weekly running volume, increasing it by no more than about 10% a week. Give heart-rate targets as % of the highest heart rate in the briefing (zone 2 is about 60-70%), or as effort (RPE) when that's missing.
- Strength splits: name the exercises with sets x reps and rest, and schedule them around runs (no heavy legs the day before a hard run).
- When asked for a plan, use numbered days ("Day 1", "Day 2", ...) with session type, duration or distance, and intensity.
- Keep answers under about 200 words unless a plan is requested. Use short markdown headings and lists. No tables.
- If something isn't in the data, say so; never invent readings or workouts.
- You are not a doctor. If the data shows warning signs (resting heart rate several bpm above baseline for days with very low HRV) or the person mentions pain, illness, chest symptoms or dizziness, recommend rest and seeing a medical professional.

Data briefing:
`;

export async function POST(req: Request) {
  const coach = getCoachModel();
  if (!coach) {
    return NextResponse.json(
      { error: "The coach isn't set up. Add OPENAI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY to .env and restart the server." },
      { status: 503 },
    );
  }

  let messages: UIMessage[];
  try {
    const body = (await req.json()) as { messages?: unknown };
    if (!Array.isArray(body.messages) || body.messages.length === 0) throw new Error();
    messages = (body.messages as UIMessage[]).slice(-MAX_MESSAGES);
  } catch {
    return NextResponse.json({ error: "Expected { messages: UIMessage[] }" }, { status: 400 });
  }

  const snapshot = await getCoachSnapshot();
  const briefing = snapshot ? snapshotToBriefing(snapshot) : "No health data has been imported yet.";

  const result = streamText({
    model: coach.model,
    instructions: INSTRUCTIONS + briefing,
    messages: await convertToModelMessages(messages),
    maxOutputTokens: 1200,
    // The client only sees a generic error; keep the details in the server log.
    onError: ({ error }) => console.error("[coach] model error:", error),
  });

  return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) });
}
