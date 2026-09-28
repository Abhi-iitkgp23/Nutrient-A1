"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { SourcesPanel } from "./sources-panel";
import { LemonSticker, SendIcon, StrawberrySticker, WhiskSticker } from "./stickers";
import type { AssistantMessage, ChatResponse, ConversationResponse, UserMessage } from "@/lib/types";

const FORMAT_ERROR = "This answer didn't match the expected format, so it wasn't shown.";
const RETRY_ERROR = "Something went wrong. Try again.";
const VALIDATION_ERROR = "Enter a message.";
const NOT_FOUND_ERROR = "That conversation could not be found.";

type ThreadMessage = UserMessage | AssistantMessage;

export function Chat({ initialConversationId }: { initialConversationId: string | null }) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(Boolean(initialConversationId));
  const [validation, setValidation] = useState<string | null>(null);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!initialConversationId) {
      return;
    }
    const conversationToLoad = initialConversationId;
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/conversations/${conversationToLoad}`);
        if (cancelled) {
          return;
        }
        if (response.status === 404) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        if (!response.ok) {
          setRetryError(RETRY_ERROR);
          setLoading(false);
          return;
        }
        const body = (await response.json()) as ConversationResponse;
        if (cancelled) {
          return;
        }
        setMessages(body.messages);
        setConversationId(body.conversationId);
        setSelectedId(latestAssistantId(body.messages));
        setLoading(false);
      } catch {
        if (!cancelled) {
          setRetryError(RETRY_ERROR);
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [initialConversationId]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    list.scrollTop = list.scrollHeight;
  }, [messages, formatError, retryError]);

  const assistants = messages.filter((message) => message.role === "assistant");
  const selected = assistants.find((message) => message.id === selectedId) ?? assistants.at(-1) ?? null;
  const busy = sending || loading;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) {
      setValidation(VALIDATION_ERROR);
      return;
    }
    setValidation(null);
    setFormatError(null);
    setRetryError(null);
    setNotFound(false);
    setSending(true);
    const optimistic: UserMessage = {
      id: `local-${crypto.randomUUID()}`,
      role: "user",
      content: text,
      claims: null,
      declined: false,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    setDraft("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: text,
          ...(conversationId ? { conversationId } : {}),
        }),
      });
      const body = (await response.json()) as ChatResponse | { error?: string };
      if (response.status === 422) {
        setFormatError(FORMAT_ERROR);
        return;
      }
      if (!response.ok) {
        setRetryError("error" in body && body.error ? body.error : RETRY_ERROR);
        return;
      }
      if (!("message" in body)) {
        setRetryError(RETRY_ERROR);
        return;
      }
      setMessages((current) => [...current, body.message]);
      setConversationId(body.conversationId);
      setSelectedId(body.message.id);
      const url = new URL(window.location.href);
      url.searchParams.set("c", body.conversationId);
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    } catch {
      setRetryError(RETRY_ERROR);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-dvh bg-wash text-cocoa md:flex md:items-center md:justify-center md:p-6 lg:p-8">
      <main className="flex min-h-dvh w-full flex-col overflow-hidden bg-cream md:h-[92vh] md:max-h-[920px] md:min-h-[720px] md:max-w-[1280px] md:rounded-[32px] md:border-2 md:border-blush md:shadow-[0_12px_40px_rgba(92,58,69,0.06)]">
        <header className="flex shrink-0 items-center justify-between border-b-2 border-blush bg-cream/90 px-4 py-3.5 backdrop-blur md:px-8 md:py-5">
          <div className="flex items-center gap-2.5 md:gap-3">
            <StrawberrySticker className="h-7 w-7 shrink-0 drop-shadow-[0_2px_4px_rgba(244,167,190,0.3)] md:h-8 md:w-8" />
            <div>
              <h1 className="text-lg leading-tight font-extrabold tracking-tight text-cocoa md:text-2xl">
                Nutrition assistant
              </h1>
              <p className="text-[11px] font-bold text-dusty md:mt-1 md:text-sm">Food, nutrition, and food safety.</p>
            </div>
          </div>
          <span className="h-2.5 w-2.5 rounded-full bg-leaf ring-4 ring-leaf/20 md:hidden" />
          <div className="hidden items-center gap-2 rounded-full border border-blush bg-wash px-3 py-1.5 text-xs font-bold text-dusty md:flex">
            <span className="h-2 w-2 animate-pulse rounded-full bg-leaf" />
            <span>Single thread session</span>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <section className="flex min-h-[50vh] flex-1 flex-col border-b-2 border-blush bg-cream md:min-h-0 md:border-r-2 md:border-b-0">
            <div ref={listRef} className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 md:gap-6 md:px-6 md:py-6">
              {loading ? <p className="text-sm font-semibold text-dusty">Loading conversation…</p> : null}
              {notFound ? (
                <p role="alert" className="text-sm font-semibold text-dusty">
                  {NOT_FOUND_ERROR}
                </p>
              ) : null}
              {!loading && messages.length === 0 && !notFound ? (
                <div className="mx-auto flex max-w-md items-center justify-center gap-2 rounded-2xl border border-yellow/60 bg-butter/40 px-3 py-2 text-center md:px-4 md:py-3">
                  <LemonSticker className="h-5 w-5 shrink-0" />
                  <span className="text-[11px] font-bold text-dusty md:text-sm">
                    Ask a question about food, nutrition, or food safety.
                  </span>
                </div>
              ) : null}
              {messages.map((message) =>
                message.role === "user" ? (
                  <p
                    key={message.id}
                    className="max-w-[85%] self-end rounded-[24px] rounded-br-md border border-pink-deep bg-pink px-4 py-3 text-sm leading-snug font-bold text-cocoa shadow-[0_4px_12px_rgba(244,167,190,0.25)] md:max-w-[80%] md:rounded-br-lg md:px-6 md:py-4 md:text-base"
                  >
                    {message.content}
                  </p>
                ) : (
                  <button
                    key={message.id}
                    type="button"
                    aria-pressed={selected?.id === message.id}
                    onClick={() => setSelectedId(message.id)}
                    className={`relative max-w-[92%] self-start rounded-[24px] rounded-bl-md bg-white px-4 py-4 text-left shadow-[0_4px_16px_rgba(92,58,69,0.04)] md:max-w-[85%] md:rounded-bl-lg md:px-7 md:py-6 ${
                      selected?.id === message.id
                        ? "border-2 border-yellow ring-2 ring-yellow/40 md:ring-4"
                        : "border-2 border-blush hover:border-yellow"
                    }`}
                  >
                    {selected?.id === message.id ? (
                      <span className="absolute -top-3 -right-2 flex items-center justify-center rounded-full border-2 border-cocoa bg-butter p-1 shadow-[0_2px_6px_rgba(92,58,69,0.15)] md:-top-3.5 md:-right-3.5 md:p-1.5">
                        <WhiskSticker />
                      </span>
                    ) : null}
                    {message.declined ? (
                      <span className="mb-2 inline-flex items-center gap-1 rounded-full border border-pink bg-wash px-2.5 py-0.5 text-[10px] font-bold text-dusty md:mb-3 md:px-3.5 md:py-1 md:text-xs">
                        <DeclineMark />
                        Outside what this assistant can answer
                      </span>
                    ) : null}
                    <span className="block text-sm leading-relaxed font-bold whitespace-pre-wrap text-cocoa md:text-lg">
                      {message.answer}
                    </span>
                  </button>
                ),
              )}
              {formatError ? (
                <p role="alert" className="text-sm font-semibold text-dusty">
                  {formatError}
                </p>
              ) : null}
              {retryError ? (
                <p role="alert" className="text-sm font-semibold text-dusty">
                  {retryError}
                </p>
              ) : null}
            </div>

            <form onSubmit={onSubmit} className="shrink-0 border-t-2 border-blush bg-cream p-3.5 md:p-6">
              <label htmlFor="message" className="sr-only">
                Message
              </label>
              <div className="flex items-end rounded-[18px] border-2 border-blush bg-white p-1.5 shadow-[0_2px_8px_rgba(92,58,69,0.04)] focus-within:border-yellow focus-within:ring-2 focus-within:ring-yellow/40 md:p-2">
                <textarea
                  id="message"
                  name="message"
                  rows={2}
                  value={draft}
                  disabled={busy}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder="Ask about food, nutrition, or food safety"
                  className="min-h-12 w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-snug font-semibold text-cocoa outline-none placeholder:text-dusty/60 disabled:opacity-60 md:min-h-16 md:px-3 md:text-base"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="mb-0.5 ml-2 flex shrink-0 items-center gap-2 rounded-[18px] border border-yellow-deep bg-yellow px-4 py-2 text-xs font-extrabold text-cocoa shadow-[0_3px_8px_rgba(246,213,107,0.4)] hover:brightness-105 active:scale-95 disabled:opacity-50 md:px-6 md:py-3 md:text-sm"
                >
                  <span>Send</span>
                  <SendIcon className="hidden h-4 w-4 md:block" />
                </button>
              </div>
              {validation ? (
                <p role="alert" className="px-2 pt-1.5 text-[10px] font-bold text-dusty md:text-xs">
                  {validation}
                </p>
              ) : null}
            </form>
          </section>
          <SourcesPanel claims={selected ? selected.claims : null} />
        </div>
      </main>
    </div>
  );
}

function DeclineMark() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="7" stroke="#8D5A68" strokeWidth="1.6" />
      <path d="M5 8H11" stroke="#8D5A68" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function latestAssistantId(messages: ThreadMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") {
      return message.id;
    }
  }
  return null;
}
