import { Smartphone } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { getI18n } from "@/lib/i18n/server";
import { CopyField } from "./copy-field";

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-muted px-1 py-0.5 text-[14px]">{children}</code>
);
const B = ({ children }: { children: React.ReactNode }) => <b className="font-semibold">{children}</b>;

/** Shown until the first export arrives. */
export async function ConnectCard({ endpoint }: { endpoint: string }) {
  const { t } = await getI18n();
  const s1 = t.connect.step1;
  const s2 = t.connect.step2;
  const s3 = t.connect.step3;

  return (
    <Card tint="primary" className="p-6">
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-[11px] bg-primary text-white">
          <Smartphone aria-hidden className="size-6" strokeWidth={2.25} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold">{t.connect.title}</h2>
          <p className="mt-1 text-[15px] leading-[22px] text-muted-foreground">{t.connect.intro}</p>
        </div>
      </div>

      <ol className="mt-6 grid gap-5 text-[15px] leading-[22px] md:grid-cols-3 md:gap-6">
        <li className="flex gap-3">
          <Step n={1} />
          <div className="min-w-0 flex-1">
            <p>
              {s1[0]}
              <B>{s1[1]}</B>
              {s1[2]}
              <B>{s1[3]}</B>
              {s1[4]}
            </p>
            <div className="mt-2">
              <CopyField value={endpoint} label={t.connect.url} />
            </div>
          </div>
        </li>
        <li className="flex gap-3">
          <Step n={2} />
          <p className="min-w-0 flex-1">
            {s2[0]}
            <Code>x-api-key</Code>
            {s2[1]}
            <Code>INGEST_API_KEY</Code>
            {s2[2]}
            <Code>.env</Code>
            {s2[3]}
          </p>
        </li>
        <li className="flex gap-3">
          <Step n={3} />
          <p className="min-w-0 flex-1">
            {s3[0]}
            <B>{s3[1]}</B>
            {s3[2]}
          </p>
        </li>
      </ol>

      <p className="mt-6 border-t border-border pt-4 text-[15px] text-muted-foreground">
        {t.connect.fullHistory}{" "}
        <Link href="/upload" className="font-medium text-primary">
          {t.common.importExport}
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
