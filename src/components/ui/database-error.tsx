import { DatabaseZap } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { Card } from "./card";

export async function DatabaseError({ message }: { message: string }) {
  const { t } = await getI18n();
  const [a, b, c, d] = t.db.body;
  return (
    <Card className="flex items-start gap-4 p-6">
      <span className="grid size-11 shrink-0 place-items-center rounded-[11px] bg-destructive text-white">
        <DatabaseZap aria-hidden className="size-6" strokeWidth={2.25} />
      </span>
      <div className="min-w-0">
        <h2 className="text-[20px] font-semibold">{t.db.title}</h2>
        <p className="mt-1 text-[15px] leading-[22px] text-muted-foreground">
          {a}
          <code>DATABASE_URL</code>
          {b}
          <code>.env</code>
          {c}
          <code>npm run db:migrate</code>
          {d}
        </p>
        <p className="mt-3 line-clamp-3 break-words text-[13px] text-subtle-foreground" dir="ltr">
          {message}
        </p>
      </div>
    </Card>
  );
}
