import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Code2,
  Download,
  Eye,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  Wand2,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Velix AI — Chat & No-Code App Builder" },
      {
        name: "description",
        content:
          "Velix AI is a fast AI chat assistant with a no-code mode that builds working web apps from plain language and previews them instantly.",
      },
      { property: "og:title", content: "Velix AI — Chat & No-Code App Builder" },
      {
        property: "og:description",
        content: "Chat with Velix AI or describe an app and get a live prototype preview instantly.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VelixApp,
});

type Msg = { id: string; role: "user" | "assistant"; content: string };
type Mode = "chat" | "builder";

const CHAT_SUGGESTIONS = [
  "Explain quantum computing simply",
  "Write a short poem about the sea",
  "සිංහලෙන් කෙටි කතාවක් ලියන්න",
  "Debug my JavaScript function",
];

const BUILD_SUGGESTIONS = [
  "A todo app with dark mode and local storage",
  "A landing page for a coffee shop",
  "සරල calculator එකක් හදන්න",
  "A pomodoro timer with sound",
];

function extractHtml(raw: string) {
  const fenced = raw.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? raw).trim();
  return body;
}

function VelixApp() {
  const [mode, setMode] = useState<Mode>("chat");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // builder state
  const [html, setHtml] = useState("");
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [lastPrompt, setLastPrompt] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (mode === "chat") endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, mode]);

  async function callApi(history: { role: string; content: string }[], m: Mode) {
    const controller = new AbortController();
    abortRef.current = controller;
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ messages: history, mode: m }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "Request failed" }));
      throw new Error(data.error ?? "Request failed");
    }
    const data = (await res.json().catch(() => ({}))) as { content?: string };
    if (!data.content) throw new Error("No response received");
    return data.content;
  }

  async function sendChat(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setError(null);
    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", content };
    const assistantId = crypto.randomUUID();
    const history = [...messages, userMsg];
    setMessages([...history, { id: assistantId, role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    try {
      const reply = await callApi(
        history.map((m) => ({ role: m.role, content: m.content })),
        "chat",
      );
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: reply } : m)));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Something went wrong";
      if (message !== "The user aborted a request.") setError(message);
      setMessages((prev) => prev.filter((m) => !(m.id === assistantId && !m.content)));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function build(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setError(null);
    setLastPrompt(content);
    setInput("");
    setBusy(true);
    try {
      const history = html
        ? [
            { role: "user", content: lastPrompt || "Build an app" },
            { role: "assistant", content: html },
            { role: "user", content: `Update the app: ${content}. Return the full HTML again.` },
          ]
        : [{ role: "user", content }];
      const reply = await callApi(history, "builder");
      setHtml(extractHtml(reply));
      setTab("preview");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Something went wrong";
      if (message !== "The user aborted a request.") setError(message);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function submit() {
    if (mode === "chat") void sendChat(input);
    else void build(input);
  }

  function download() {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "velix-app.html";
    a.click();
    URL.revokeObjectURL(url);
  }

  const suggestions = mode === "chat" ? CHAT_SUGGESTIONS : BUILD_SUGGESTIONS;

  return (
    <main className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary shadow-[0_0_24px_-6px_var(--color-primary)]">
            <Sparkles className="size-5 text-primary-foreground" />
          </div>
          <div className="flex-1">
            <h1 className="text-base font-semibold tracking-tight">Velix AI</h1>
            <p className="text-xs text-muted-foreground">
              {mode === "chat" ? "Always-on AI assistant" : "No-code app builder"}
            </p>
          </div>
          {(messages.length > 0 || html) && (
            <button
              onClick={() => {
                setMessages([]);
                setHtml("");
                setError(null);
              }}
              aria-label="Clear"
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
        <div className="mx-auto w-full max-w-5xl px-4 pb-3">
          <div className="flex gap-1 rounded-xl border border-border bg-card p-1">
            <button
              onClick={() => setMode("chat")}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                mode === "chat"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <MessageSquare className="size-4" /> Chat
            </button>
            <button
              onClick={() => setMode("builder")}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                mode === "builder"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Wand2 className="size-4" /> No-Code
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {mode === "chat" ? (
          messages.length === 0 ? (
            <Empty
              title="How can I help you?"
              subtitle="Ask anything — code, ideas, translations, or explanations."
              suggestions={suggestions}
              onPick={(s) => void sendChat(s)}
            />
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
          )
        ) : !html && !busy ? (
          <Empty
            title="Describe your app"
            subtitle="Velix builds a working web app and shows you a live prototype preview."
            suggestions={suggestions}
            onPick={(s) => void build(s)}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
                <button
                  onClick={() => setTab("preview")}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${
                    tab === "preview"
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Eye className="size-3.5" /> Preview
                </button>
                <button
                  onClick={() => setTab("code")}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${
                    tab === "code"
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Code2 className="size-3.5" /> Code
                </button>
              </div>
              <div className="flex-1" />
              {html && (
                <>
                  <button
                    onClick={() => void build(lastPrompt)}
                    disabled={busy}
                    className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    <RefreshCw className="size-3.5" /> Regenerate
                  </button>
                  <button
                    onClick={download}
                    className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Download className="size-3.5" /> HTML
                  </button>
                </>
              )}
            </div>

            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              {busy ? (
                <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                  <Wand2 className="size-6 animate-pulse text-primary" />
                  Building your app…
                </div>
              ) : tab === "preview" ? (
                <iframe
                  title="App preview"
                  srcDoc={html}
                  sandbox="allow-scripts allow-forms allow-modals allow-popups"
                  className="h-[70vh] w-full bg-white"
                />
              ) : (
                <pre className="h-[70vh] overflow-auto p-4 text-xs leading-relaxed whitespace-pre-wrap text-card-foreground">
                  {html}
                </pre>
              )}
            </div>
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
            submit();
          }}
          className="mx-auto flex w-full max-w-5xl items-end gap-2 px-4 py-3"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={
              mode === "chat"
                ? "Message Velix AI…"
                : html
                  ? "Describe a change to your app…"
                  : "Describe the app you want to build…"
            }
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
              aria-label={mode === "chat" ? "Send message" : "Build app"}
              className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
            >
              {mode === "chat" ? <ArrowUp className="size-5" /> : <Wand2 className="size-5" />}
            </button>
          )}
        </form>
      </div>
    </main>
  );
}

function Empty({
  title,
  subtitle,
  suggestions,
  onPick,
}: {
  title: string;
  subtitle: string;
  suggestions: string[];
  onPick: (s: string) => void;
}) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 pt-10 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-secondary">
        <Sparkles className="size-8 text-primary" />
      </div>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="grid w-full gap-2 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-xl border border-border bg-card p-3 text-left text-sm text-card-foreground transition-colors hover:border-primary/50 hover:bg-secondary"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
