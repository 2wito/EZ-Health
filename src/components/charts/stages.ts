// Shared by server and client components (a "use client" module can't export plain values to the server).

/** Depth order, deepest last. Colors are a validated one-hue ramp plus a warm Awake. */
export const STAGES = [
  { key: "awake", stage: "AWAKE", label: "Awake", color: "var(--stage-awake)" },
  { key: "rem", stage: "REM", label: "REM", color: "var(--stage-rem)" },
  { key: "core", stage: "CORE", label: "Core", color: "var(--stage-core)" },
  { key: "deep", stage: "DEEP", label: "Deep", color: "var(--stage-deep)" },
] as const;

/** Asleep without stage detail (older watches, third-party apps). */
export const UNSPECIFIED = { key: "unspecified", stage: "ASLEEP", label: "Asleep", color: "var(--gray)" } as const;
