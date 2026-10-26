import { FlaskConical } from "lucide-react";
import { revalidatePath } from "next/cache";
import { Card } from "@/components/ui/card";
import { clearDemoData } from "@/lib/demo/demo-data";

async function removeDemoData() {
  "use server";
  await clearDemoData();
  revalidatePath("/", "layout");
}

/** Shown while demo data is loaded, so it never gets mixed into a real import. */
export function DemoNotice() {
  return (
    <Card className="flex flex-wrap items-center gap-4 border-activity/40">
      <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-activity text-white">
        <FlaskConical aria-hidden className="size-5" strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Demo data is loaded</p>
        <p className="text-[14px] text-muted-foreground">
          Remove it before importing your own export, or the dashboards will mix the two.
        </p>
      </div>
      <form action={removeDemoData}>
        <button
          type="submit"
          className="h-10 rounded-xl bg-muted px-4 text-[15px] font-semibold text-destructive transition-opacity active:opacity-80"
        >
          Remove Demo Data
        </button>
      </form>
    </Card>
  );
}
