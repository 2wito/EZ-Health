import type { Locale } from "../config";
import { en, type Messages } from "./en";
import { he } from "./he";

export type { Messages };

const MESSAGES: Record<Locale, Messages> = { en, he };

export const getMessages = (locale: Locale) => MESSAGES[locale];
