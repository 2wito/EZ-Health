import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "./card";

export function EmptyState({
  icon: Icon,
  tile,
  title,
  children,
}: {
  icon: LucideIcon;
  /** Tailwind background class for the icon tile, e.g. "bg-heart". */
  tile: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center px-6 py-14 text-center">
      <span className={cn("grid size-14 place-items-center rounded-[14px] text-white", tile)}>
        <Icon aria-hidden className="size-7" strokeWidth={2.25} />
      </span>
      <h2 className="mt-4 text-[20px] font-semibold">{title}</h2>
      <div className="mt-1.5 max-w-md text-[15px] leading-[22px] text-muted-foreground">{children}</div>
    </Card>
  );
}
