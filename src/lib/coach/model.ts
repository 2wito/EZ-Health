import "server-only";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";

// Which model answers the coach. Set AI_COACH_MODEL to pick one explicitly,
// e.g. "openai:gpt-5.4-mini" or "google:gemini-flash-latest"; otherwise the
// provider is chosen from whichever API key is present.
const DEFAULTS = { openai: "gpt-5.4-mini", google: "gemini-flash-latest" } as const;

export function getCoachModel() {
  const configured = process.env.AI_COACH_MODEL?.trim();
  const [prefix, ...rest] = configured?.includes(":") ? configured.split(":") : [undefined, configured];
  const explicitId = rest.join(":") || undefined;

  const provider =
    prefix === "openai" || prefix === "google"
      ? prefix
      : process.env.OPENAI_API_KEY
        ? "openai"
        : process.env.GOOGLE_GENERATIVE_AI_API_KEY
          ? "google"
          : null;
  if (!provider) return null;
  if (provider === "openai" && !process.env.OPENAI_API_KEY) return null;
  if (provider === "google" && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) return null;

  const id = explicitId ?? DEFAULTS[provider];
  return {
    model: provider === "openai" ? openai(id) : google(id),
    label: `${provider === "openai" ? "OpenAI" : "Google"} ${id}`,
  };
}
