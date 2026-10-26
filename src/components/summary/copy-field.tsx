"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="flex items-center gap-2 rounded-xl bg-muted py-1.5 pl-3 pr-1.5">
      <code className="min-w-0 flex-1 truncate text-[14px]">{value}</code>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        className="grid size-8 shrink-0 place-items-center rounded-lg text-primary hover:bg-card"
      >
        {copied ? <Check aria-hidden className="size-4" strokeWidth={2.5} /> : <Copy aria-hidden className="size-4" />}
      </button>
    </div>
  );
}
