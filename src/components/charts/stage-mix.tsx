"use client";

import { useI18n } from "@/lib/i18n/client";
import { STAGES, UNSPECIFIED } from "./stages";

type Mix = { deep: number; core: number; rem: number; awake: number; unspecified: number };

/**
 * Part-to-whole of a night: one 100% bar (2px surface gaps between segments)
 * with every stage labeled directly, so nothing depends on hover.
 */
export function StageMix({ mix }: { mix: Mix }) {
  const { t, f } = useI18n();
  const parts = [...STAGES, UNSPECIFIED]
    .map((s) => ({ ...s, hours: mix[s.key] }))
    .filter((p) => p.hours > 0);
  const total = parts.reduce((a, p) => a + p.hours, 0);
  if (total === 0) return null;

  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={t.sleep.stageMix}>
        {parts.map((p) => (
          <div key={p.key} style={{ flexGrow: p.hours, background: p.color }} />
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
        {parts.map((p) => (
          <div key={p.key} className="flex items-start gap-2">
            <span aria-hidden className="mt-1 size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} />
            <div>
              <dt className="text-muted-foreground">{t.stages[p.key]}</dt>
              <dd className="font-semibold">
                {f.duration(p.hours)}{" "}
                <span className="font-normal text-muted-foreground">{Math.round((p.hours / total) * 100)}%</span>
              </dd>
            </div>
          </div>
        ))}
      </dl>
    </div>
  );
}
