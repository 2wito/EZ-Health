import { DatabaseZap } from "lucide-react";
import { Card } from "./card";

export function DatabaseError({ message }: { message: string }) {
  return (
    <Card className="flex items-start gap-4 p-6">
      <span className="grid size-11 shrink-0 place-items-center rounded-[11px] bg-destructive text-white">
        <DatabaseZap aria-hidden className="size-6" strokeWidth={2.25} />
      </span>
      <div className="min-w-0">
        <h2 className="text-[20px] font-semibold">Can&apos;t reach the database</h2>
        <p className="mt-1 text-[15px] leading-[22px] text-muted-foreground">
          Check that <code>DATABASE_URL</code> in <code>.env</code> points to a running Postgres, then run{" "}
          <code>npm run db:migrate</code>.
        </p>
        <p className="mt-3 line-clamp-3 break-words text-[13px] text-subtle-foreground">{message}</p>
      </div>
    </Card>
  );
}
