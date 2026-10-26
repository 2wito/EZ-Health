import { cn } from "@/lib/utils";

export type Tint = "primary" | "heart" | "breathing" | "sleep" | "activity" | "workout" | "coach";

export const tintColor = (tint: Tint) => `var(--${tint})`;

/** Grouped-table card. `tint` adds the faint category glow in the top corner. */
export function Card({
  tint,
  className,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { tint?: Tint }) {
  return (
    <div
      className={cn("rounded-3xl border border-border bg-card p-5 shadow-card", tint && "glow", className)}
      style={tint ? { ...style, ["--tint" as string]: tintColor(tint) } : style}
      {...props}
    />
  );
}

/** iOS section title that sits above a group of cards. */
export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex items-baseline justify-between [header+&]:mt-0">
      <h2 className="font-display text-[22px] font-bold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}
