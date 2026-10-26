"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";

/** "Monday, October 26" in the viewer's own timezone. */
export function TodayLabel() {
  const { f } = useI18n();
  const [label, setLabel] = useState<string>();
  useEffect(() => {
    setLabel(f.today());
  }, [f]);
  // Reserve the line height so the title doesn't jump when the date appears.
  return <span className="inline-block min-h-[1lh]">{label}</span>;
}
