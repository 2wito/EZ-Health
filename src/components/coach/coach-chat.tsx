"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowUp, RotateCcw, Sparkles, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";



// Model output is markdown; map it onto the app's type scale.
const MARKDOWN: Components = {
  h1: ({ children }) => <p className="mb-1 mt-3 font-semibold first:mt-0">{children}</p>,
  h2: ({ children }) => <p className="mb-1 mt-3 font-semibold first:mt-0">{children}</p>,
  h3: ({ children }) => <p className="mb-1 mt-3 font-semibold first:mt-0">{children}</p>,
  h4: ({ children }) => <p className="mb-1 mt-3 font-semibold first:mt-0">{children}</p>,
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 ps-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 ps-5 last:mb-0">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  code: ({ children }) => <code className="rounded bg-muted px-1 text-[14px]">{children}</code>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-primary underline">
      {children}
    </a>
  ),
};

export function CoachChat({ enabled, modelLabel }: { enabled: boolean; modelLabel: string | null }) {
  const { t, locale } = useI18n();
  // The locale rides along so the coach answers in the language of the page. Read
  // through a ref: useChat keeps its first transport, and the language can change.
  const localeRef = useRef(locale);
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);
  const [transport] = useState(() => new DefaultChatTransport({ api: "/api/coach", body: () => ({ locale: localeRef.current }) }));
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, stop, error, regenerate, setMessages } = useChat({ transport });
  const busy = status === "submitted" || status === "streaming";
  const scroller = useRef<HTMLDivElement>(null);

  // Follow the answer as it streams in.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    sendMessage({ text: trimmed });
    setInput("");
  }

  return (
    <div className="relative h-full">
      {/* Spectrum glow while the coach is thinking: answers the person's action, nothing else animates. */}
      <div
        aria-hidden
        className={cn(
          "bg-spectrum absolute -inset-1 rounded-[28px] blur-xl transition-opacity duration-500",
          busy ? "opacity-40 motion-safe:animate-pulse" : "opacity-0",
        )}
      />
      <section
        aria-label={t.coach.chat}
        className="relative flex h-full min-h-[560px] flex-col rounded-3xl border border-border bg-card shadow-card"
      >
        <header className="flex items-center gap-3 border-b border-border px-5 py-3.5">
          <span className="bg-spectrum grid size-8 place-items-center rounded-[9px] text-white">
            <Sparkles aria-hidden className="size-[18px]" strokeWidth={2.25} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-semibold leading-tight">{t.coach.name}</p>
            {modelLabel && <p className="truncate text-[12px] text-muted-foreground">{modelLabel}</p>}
          </div>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                stop();
                setMessages([]);
              }}
              className="text-[15px] font-medium text-primary"
            >
              {t.coach.newChat}
            </button>
          )}
        </header>

        <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto px-5 py-5" aria-live="polite">
          {messages.length === 0 && (
            <div className="flex h-full flex-col justify-end gap-4">
              <p className="max-w-md text-[15px] leading-[22px] text-muted-foreground">
                {enabled ? t.coach.intro : t.coach.disabled}
              </p>
              {enabled && (
                <div className="flex flex-wrap gap-2">
                  {t.coach.suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="rounded-full border border-border bg-card-elevated px-3.5 py-2 text-start text-[14px] transition-colors hover:bg-muted"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {messages.map((m) => {
            const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
            return m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <p className="max-w-[80%] whitespace-pre-wrap rounded-[20px] rounded-ee-md bg-primary px-4 py-2.5 text-[15px] text-primary-foreground">
                  {text}
                </p>
              </div>
            ) : (
              <div key={m.id} className="max-w-[92%] text-[15px] leading-[22px]">
                <ReactMarkdown components={MARKDOWN}>{text}</ReactMarkdown>
              </div>
            );
          })}

          {status === "submitted" && <p className="text-[15px] text-muted-foreground">{t.coach.thinking}</p>}

          {error && (
            <div role="alert" className="flex items-center gap-3 rounded-2xl bg-muted px-4 py-3 text-[14px]">
              <span className="flex-1">{t.coach.error}</span>
              <button type="button" onClick={() => regenerate()} className="inline-flex items-center gap-1 font-medium text-primary">
                <RotateCcw aria-hidden className="size-4" /> {t.coach.retry}
              </button>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-center gap-2 border-t border-border p-3"
        >
          <label htmlFor="coach-input" className="sr-only">
            {t.coach.message}
          </label>
          <input
            id="coach-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!enabled}
            placeholder={enabled ? t.coach.placeholder : t.coach.placeholderOff}
            autoComplete="off"
            className="h-10 min-w-0 flex-1 rounded-full border border-border bg-background px-4 text-[15px] outline-none placeholder:text-subtle-foreground focus-visible:border-primary disabled:opacity-60"
          />
          {busy ? (
            <button
              type="button"
              onClick={() => stop()}
              aria-label={t.coach.stop}
              className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground text-background"
            >
              <Square aria-hidden className="size-3.5" fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!enabled || !input.trim()}
              aria-label={t.coach.send}
              className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-35"
            >
              <ArrowUp aria-hidden className="size-5" strokeWidth={2.5} />
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
