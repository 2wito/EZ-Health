// Shared by server and client components (a "use client" module can't export plain values to the server).

/** Depth order, deepest last. Colors are a validated one-hue ramp plus a warm Awake. Labels: `t.stages[key]`. */
export const STAGES = [
  { key: "awake", stage: "AWAKE", color: "var(--stage-awake)" },
  { key: "rem", stage: "REM", color: "var(--stage-rem)" },
  { key: "core", stage: "CORE", color: "var(--stage-core)" },
  { key: "deep", stage: "DEEP", color: "var(--stage-deep)" },
] as const;

/** Asleep without stage detail (older watches, third-party apps). */
export const UNSPECIFIED = { key: "unspecified", stage: "ASLEEP", color: "var(--gray)" } as const;
