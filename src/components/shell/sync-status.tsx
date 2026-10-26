import { getI18n } from "@/lib/i18n/server";
import { getLastSync } from "@/lib/queries/summary";
import { cn } from "@/lib/utils";

/** "Synced 5 minutes ago" line for the sidebar footer. */
export async function SyncStatus() {
  const [last, { t, f }] = await Promise.all([getLastSync(), getI18n()]);
  if (last === undefined) return null;

  const failed = last?.failed ?? false;
  return (
    <p className="flex items-center gap-2 px-2.5 text-[13px] text-muted-foreground">
      <span
        aria-hidden
        className={cn("size-2 rounded-full", !last ? "bg-subtle-foreground" : failed ? "bg-destructive" : "bg-workout")}
      />
      {!last ? t.shell.noData : failed ? t.shell.updateFailed(f.ago(last.at)) : t.shell.updated(f.ago(last.at))}
    </p>
  );
}
