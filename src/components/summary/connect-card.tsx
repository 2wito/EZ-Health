import { Smartphone } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { CopyField } from "./copy-field";

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-muted px-1 py-0.5 text-[14px]">{children}</code>
);

/** Shown until the first export arrives. */
export function ConnectCard({ endpoint }: { endpoint: string }) {
  return (
    <Card tint="primary" className="p-6">
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-[11px] bg-primary text-white">
          <Smartphone aria-hidden className="size-6" strokeWidth={2.25} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold">Connect your iPhone</h2>
          <p className="mt-1 text-[15px] leading-[22px] text-muted-foreground">
            Your dashboard fills in once Health Auto Export sends its first export.
          </p>
        </div>
      </div>

      <ol className="mt-6 grid gap-5 text-[15px] leading-[22px] md:grid-cols-3 md:gap-6">
        <li className="flex gap-3">
          <Step n={1} />
          <div className="min-w-0 flex-1">
            <p>
              In Health Auto Export, open <b className="font-semibold">Automations</b> and add a{" "}
              <b className="font-semibold">REST API</b> automation with this URL:
            </p>
            <div className="mt-2">
              <CopyField value={endpoint} label="URL" />
            </div>
          </div>
        </li>
        <li className="flex gap-3">
          <Step n={2} />
          <p className="min-w-0 flex-1">
            Add a header named <Code>x-api-key</Code> with the value of <Code>INGEST_API_KEY</Code> from your{" "}
            <Code>.env</Code> file.
          </p>
        </li>
        <li className="flex gap-3">
          <Step n={3} />
          <p className="min-w-0 flex-1">
            Pick JSON, group by hour, and include heart rate, HRV, respiratory rate, active energy, sleep and workouts.
            Then tap <b className="font-semibold">Manual Export</b> to send your history.
          </p>
        </li>
      </ol>

      <p className="mt-6 border-t border-border pt-4 text-[15px] text-muted-foreground">
        Want your full history first?{" "}
        <Link href="/upload" className="font-medium text-primary">
          Import an Apple Health export
        </Link>
      </p>
    </Card>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-[13px] font-semibold text-white">
      {n}
    </span>
  );
}
