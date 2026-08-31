import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Sparkles, Square, Trash2 } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Velix AI — Smart AI Chat Assistant" },
      {
        name: "description",
        content:
          "Velix AI is a fast, accurate AI chat assistant. Ask anything and get clear answers in seconds, in English or Sinhala.",
      },
      { property: "og:title", content: "Velix AI — Smart AI Chat Assistant" },
      {
        property: "og:description",
        content: "Chat with Velix AI for fast, accurate answers in English or Sinhala.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VelixChat,
});

type Msg = { id: string; role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Explain quantum computing simply",
  "Write a short poem about the sea",
  "සිංහලෙන් කෙටි කතාවක් ලියන්න",
  "Debug my JavaScript function",
];

function VelixChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setError(null);
    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", content };
    const assistantId = crypto.randomUUID();
    const history = [...messages, userMsg];
    setMessages([...history, { id: assistantId, role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(data.error ?? "Request failed");
      }

      const type = res.headers.get("content-type") ?? "";
      if (type.includes("application/json")) {
        const data = (await res.json().catch(() => ({}))) as { content?: string };
        if (!data.content) throw new Error("No response received");
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: data.content! } : m)),
        );
      } else if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: acc } : m)),
          );
        }
        if (!acc) {
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
          setError("No response received. Please try again.");
        }
      } else {
        throw new Error("No response received");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Something went wrong";
      if (message !== "The user aborted a request.") setError(message);
      setMessages((prev) => prev.filter((m) => !(m.id === assistantId && !m.content)));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <main className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary shadow-[0_0_24px_-6px_var(--color-primary)]">
            <Sparkles className="size-5 text-primary-foreground" />
          </div>
          <div className="flex-1">
            <h1 className="text-base font-semibold tracking-tight">Velix AI</h1>
            <p className="text-xs text-muted-foreground">Always-on AI assistant</p>
          </div>
          {messages.length > 0 && (
            <button
              onClick={() => {
                setMessages([]);
                setError(null);
              }}
              aria-label="Clear chat"
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center gap-6 pt-10 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-secondary">
              <Sparkles className="size-8 text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">How can I help you?</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Ask anything — code, ideas, translations, or explanations.
              </p>
            </div>
            <div className="grid w-full gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-xl border border-border bg-card p-3 text-left text-sm text-card-foreground transition-colors hover:border-primary/50 hover:bg-secondary"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((m) => (
              <div
                key={m.id}
                className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground"
                      : "max-w-[92%] rounded-2xl rounded-bl-md border border-border bg-card px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-card-foreground"
                  }
                >
                  {m.content || <span className="text-muted-foreground">Thinking…</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 border-t border-border/60 bg-background/80 backdrop-blur-xl">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="mx-auto flex w-full max-w-3xl items-end gap-2 px-4 py-3"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="Message Velix AI…"
            className="max-h-40 min-h-11 flex-1 resize-none rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/60"
          />
          {busy ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              aria-label="Stop"
              className="flex size-11 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground"
            >
              <Square className="size-4" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label="Send message"
              className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
            >
              <ArrowUp className="size-5" />
            </button>
          )}
        </form>
      </div>
    </main>
  );
}
