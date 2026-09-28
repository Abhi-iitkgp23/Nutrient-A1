"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { SourcesPanel } from "./sources-panel";
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
    <div className="flex min-h-dvh flex-col bg-stone-50 text-stone-900 md:h-dvh md:flex-row md:overflow-hidden">
      <section className="flex min-h-0 flex-1 flex-col md:max-h-dvh">
        <header className="border-b border-stone-200 px-4 py-4">
          <h1 className="text-lg font-semibold">Nutrition assistant</h1>
          <p className="text-sm text-stone-600">Food, nutrition, and food safety.</p>
        </header>
        <div ref={listRef} className="flex min-h-[50vh] flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 md:min-h-0">
          {loading ? <p className="text-sm text-stone-600">Loading conversation…</p> : null}
          {notFound ? (
            <p role="alert" className="text-sm text-stone-700">
              {NOT_FOUND_ERROR}
            </p>
          ) : null}
          {!loading && messages.length === 0 && !notFound ? (
            <p className="text-sm text-stone-600">Ask a question about food, nutrition, or food safety.</p>
          ) : null}
          {messages.map((message) =>
            message.role === "user" ? (
              <p
                key={message.id}
                className="max-w-[40rem] self-end rounded-2xl bg-stone-800 px-4 py-2 text-sm text-white"
              >
                {message.content}
              </p>
            ) : (
              <button
                key={message.id}
                type="button"
                aria-pressed={selected?.id === message.id}
                onClick={() => setSelectedId(message.id)}
                className={`max-w-[40rem] self-start rounded-2xl border px-4 py-3 text-left text-sm ${
                  selected?.id === message.id
                    ? "border-stone-800 bg-white"
                    : "border-stone-200 bg-white"
                }`}
              >
                {message.declined ? (
                  <span className="mb-1 block text-xs font-medium text-stone-500">
                    Outside what this assistant can answer
                  </span>
                ) : null}
                <span className="block whitespace-pre-wrap">{message.answer}</span>
              </button>
            ),
          )}
          {formatError ? (
            <p role="alert" className="text-sm text-stone-700">
              {formatError}
            </p>
          ) : null}
          {retryError ? (
            <p role="alert" className="text-sm text-stone-700">
              {retryError}
            </p>
          ) : null}
        </div>
        <form onSubmit={onSubmit} className="border-t border-stone-200 px-4 py-3">
          <label htmlFor="message" className="sr-only">
            Message
          </label>
          <div className="flex items-end gap-2">
            <textarea
              id="message"
              name="message"
              rows={2}
              value={draft}
              disabled={sending || loading}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Ask about food, nutrition, or food safety"
              className="min-h-16 flex-1 resize-none rounded-xl border border-stone-300 bg-white px-3 py-2 text-base outline-none focus:border-stone-500 disabled:bg-stone-100"
            />
            <button
              type="submit"
              disabled={sending || loading}
              className="rounded-xl bg-stone-800 px-4 py-2 text-sm font-medium text-white disabled:bg-stone-400"
            >
              Send
            </button>
          </div>
          {validation ? (
            <p role="alert" className="pt-2 text-sm text-stone-700">
              {validation}
            </p>
          ) : null}
        </form>
      </section>
      <SourcesPanel claims={selected ? selected.claims : null} />
    </div>
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
