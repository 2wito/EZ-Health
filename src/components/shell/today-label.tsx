"use client";

import { useEffect, useState } from "react";

/** "Monday, October 26" in the viewer's own timezone. */
export function TodayLabel() {
  const [label, setLabel] = useState<string>();
  useEffect(() => {
    setLabel(new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }));
  }, []);
  // Reserve the line height so the title doesn't jump when the date appears.
  return <span className="inline-block min-h-[1lh]">{label}</span>;
}
