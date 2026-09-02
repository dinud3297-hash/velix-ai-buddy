import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUp,
  Check,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Eye,
  FileCode2,
  Folder,
  Globe,
  ImagePlus,
  Loader2,
  MessageSquare,
  Monitor,
  RefreshCw,
  Rocket,
  ScanLine,
  Smartphone,
  Sparkles,
  Square,
  Tablet,
  Trash2,
  Wand2,
  X,
} from "lucide-react";

import { buildPreviewHtml, buildTree, parseProject, type Project, type TreeNode } from "@/lib/preview";
import { createZip } from "@/lib/zip";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Velix AI — Chat & Real-Time No-Code App Builder" },
      {
        name: "description",
        content:
          "Velix AI builds complete multi-file web, React and React Native projects from plain language, with a live preview, real file tree, auto error fixing and one-click Netlify hosting.",
      },
      { property: "og:title", content: "Velix AI — Real-Time No-Code App Builder" },
      {
        property: "og:description",
        content:
          "Describe an app, watch Velix AI generate the files, preview it live and deploy it to Netlify in one click.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VelixApp,
});

type Msg = { id: string; role: "user" | "assistant"; content: string; images?: string[] };
type Mode = "chat" | "builder" | "web";
type Pane = "preview" | "code" | "chat";
type Device = "mobile" | "tablet" | "desktop";
type RuntimeError = { message: string; stack: string };
type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type ApiMsg = { role: string; content: string | Part[] };

const CHAT_SUGGESTIONS = [
  "Explain quantum computing simply",
  "Scan this photo and extract all the text",
  "සිංහලෙන් කෙටි කතාවක් ලියන්න",
  "Debug my JavaScript function",
];

const BUILD_SUGGESTIONS = [
  "A React dashboard with charts and dark mode",
  "React Native style mobile fitness tracker app",
  "සිංහල notes app එකක් local storage එක්ක",
  "A realtime chat UI like Facebook Messenger",
];

const WEB_SUGGESTIONS = [
  "A multi-page agency website with pricing and blog",
  "Restaurant website with menu, gallery and booking",
  "සිංහල ව්‍යාපාරික website එකක් contact form එක්ක",
  "SaaS landing site with FAQ and testimonials",
];

const MAX_IMAGE_EDGE = 1400;

/** Downscale + JPEG-encode an upload so vision requests stay small and fast. */
async function toCompressedDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

const DEVICE_WIDTH: Record<Device, string> = {
  mobile: "390px",
  tablet: "768px",
  desktop: "100%",
};

function language(path: string) {
  const ext = path.split(".").pop() ?? "";
  return (
    { js: "JavaScript", jsx: "React", ts: "TypeScript", tsx: "React TS", css: "CSS", html: "HTML", json: "JSON", md: "Markdown" }[
      ext
    ] ?? ext.toUpperCase()
  );
}

function VelixApp() {
  const [mode, setMode] = useState<Mode>("chat");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // builder state
  const [project, setProject] = useState<Project | null>(null);
  const [buildLog, setBuildLog] = useState<Msg[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>("preview");
  const [device, setDevice] = useState<Device>("mobile");
  const [runtimeErrors, setRuntimeErrors] = useState<RuntimeError[]>([]);
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (mode === "chat") endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, mode]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { __velix?: boolean; message?: string; stack?: string };
      if (!data?.__velix || !data.message) return;
      setRuntimeErrors((prev) =>
        prev.some((e) => e.message === data.message)
          ? prev
          : [...prev, { message: data.message!, stack: data.stack ?? "" }].slice(-6),
      );
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const previewHtml = useMemo(() => (project ? buildPreviewHtml(project) : ""), [project]);
  const tree = useMemo(() => (project ? buildTree(project.files) : []), [project]);
  const currentFile = useMemo(
    () => project?.files.find((f) => f.path === activeFile) ?? project?.files[0] ?? null,
    [project, activeFile],
  );

  const callApi = useCallback(async (history: ApiMsg[], m: Mode) => {
    const controller = new AbortController();
    abortRef.current = controller;
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ messages: history, mode: m }),
    });
    const data = (await res.json().catch(() => ({}))) as { content?: string; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Request failed");
    if (!data.content) throw new Error("No response received");
    return data.content;
  }, []);

  async function addImages(list: FileList | null) {
    if (!list?.length) return;
    const picked = Array.from(list).slice(0, 4 - images.length);
    const encoded = await Promise.all(
      picked.filter((f) => f.type.startsWith("image/")).map(toCompressedDataUrl),
    );
    setImages((prev) => [...prev, ...encoded].slice(0, 4));
  }

  async function sendChat(text: string) {
    const content = text.trim();
    const attached = images;
    if ((!content && attached.length === 0) || busy) return;
    setError(null);
    const prompt = content || "Scan this image and tell me everything it contains.";
    const userMsg: Msg = {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
      ...(attached.length ? { images: attached } : {}),
    };
    const assistantId = crypto.randomUUID();
    const history = [...messages, userMsg];
    setMessages([...history, { id: assistantId, role: "assistant", content: "" }]);
    setInput("");
    setImages([]);
    setBusy(true);
    try {
      const reply = await callApi(
        history.map((m) =>
          m.images?.length
            ? {
                role: m.role,
                content: [
                  { type: "text", text: m.content },
                  ...m.images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
                ] as Part[],
              }
            : { role: m.role, content: m.content },
        ),
        "chat",
      );
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: reply } : m)));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Something went wrong";
      if (!message.includes("abort")) setError(message);
      setMessages((prev) => prev.filter((m) => !(m.id === assistantId && !m.content)));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }



  async function build(instruction: string, opts: { silent?: boolean } = {}) {
    const content = instruction.trim();
    if (!content || busy) return;
    setError(null);
    setInput("");
    setBusy(true);
    setRuntimeErrors([]);
    setStatus(project ? "Applying your changes…" : "Designing your project…");
    if (!opts.silent)
      setBuildLog((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content }]);

    try {
      const history: { role: string; content: string }[] = [];
      if (project) {
        history.push({ role: "user", content: "Current project" });
        history.push({ role: "assistant", content: JSON.stringify(project) });
        history.push({
          role: "user",
          content: `${content}\n\nReturn the FULL updated project JSON with every file.`,
        });
      } else {
        history.push({ role: "user", content });
      }

      setStatus("Generating files…");
      const reply = await callApi(history, "builder");
      setStatus("Wiring up the live preview…");
      const next = parseProject(reply);
      setProject(next);
      setActiveFile(next.entry);
      setPane("preview");
      setBuildLog((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: next.summary || `Built ${next.name} with ${next.files.length} files.`,
        },
      ]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Something went wrong";
      if (!message.includes("abort")) setError(message);
    } finally {
      setBusy(false);
      setStatus("");
      abortRef.current = null;
    }
  }

  function autoFix() {
    const report = runtimeErrors
      .map((e, i) => `${i + 1}. ${e.message}${e.stack ? `\n   ${e.stack.slice(0, 200)}` : ""}`)
      .join("\n");
    void build(
      `The live preview reported these runtime errors. Diagnose and fix them properly, then return the full corrected project:\n${report}`,
    );
  }

  function submit() {
    if (mode === "chat") void sendChat(input);
    else void build(input);
  }

  function downloadZip() {
    if (!project) return;
    const blob = createZip(project.files);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name || "velix-app"}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyFile() {
    if (!currentFile) return;
    void navigator.clipboard.writeText(currentFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const suggestions = mode === "chat" ? CHAT_SUGGESTIONS : BUILD_SUGGESTIONS;

  return (
    <main className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary shadow-[0_0_24px_-6px_var(--color-primary)]">
            <Sparkles className="size-5 text-primary-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold tracking-tight">Velix AI</h1>
            <p className="truncate text-xs text-muted-foreground">
              {mode === "chat"
                ? "Always-on AI assistant"
                : project
                  ? `${project.name} · ${project.files.length} files`
                  : "Real-time no-code app builder"}
            </p>
          </div>
          {mode === "builder" && project && (
            <button
              onClick={() => setDeployOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
            >
              <Rocket className="size-3.5" /> Deploy
            </button>
          )}
          {(messages.length > 0 || project) && (
            <button
              onClick={() => {
                setMessages([]);
                setProject(null);
                setBuildLog([]);
                setRuntimeErrors([]);
                setError(null);
              }}
              aria-label="Clear"
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
        <div className="mx-auto w-full max-w-7xl px-4 pb-3">
          <div className="flex gap-1 rounded-xl border border-border bg-card p-1">
            {(["chat", "builder"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  mode === m
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "chat" ? <MessageSquare className="size-4" /> : <Wand2 className="size-4" />}
                {m === "chat" ? "Chat" : "No-Code"}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-5">
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
                <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
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
        ) : !project && !busy ? (
          <Empty
            title="Describe your app"
            subtitle="Velix generates a real multi-file project — any framework — and previews it live while it builds."
            suggestions={suggestions}
            onPick={(s) => void build(s)}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
                {(
                  [
                    ["preview", Eye, "Preview"],
                    ["code", Code2, "Code"],
                    ["chat", MessageSquare, "Build log"],
                  ] as [Pane, typeof Eye, string][]
                ).map(([key, Icon, label]) => (
                  <button
                    key={key}
                    onClick={() => setPane(key)}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${
                      pane === key
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="size-3.5" /> {label}
                  </button>
                ))}
              </div>
              <div className="flex-1" />
              {pane === "preview" && (
                <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
                  {(
                    [
                      ["mobile", Smartphone],
                      ["tablet", Tablet],
                      ["desktop", Monitor],
                    ] as [Device, typeof Monitor][]
                  ).map(([key, Icon]) => (
                    <button
                      key={key}
                      aria-label={key}
                      onClick={() => setDevice(key)}
                      className={`rounded-md p-1.5 ${
                        device === key ? "bg-secondary text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      <Icon className="size-3.5" />
                    </button>
                  ))}
                </div>
              )}
              {project && (
                <>
                  <button
                    onClick={() => void build("Improve and polish the app, keep all features working.")}
                    disabled={busy}
                    className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    <RefreshCw className="size-3.5" /> Improve
                  </button>
                  <button
                    onClick={downloadZip}
                    className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Download className="size-3.5" /> ZIP
                  </button>
                </>
              )}
            </div>

            {runtimeErrors.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{runtimeErrors[0]?.message}</span>
                <button
                  onClick={autoFix}
                  disabled={busy}
                  className="rounded-md bg-destructive px-2.5 py-1 font-semibold text-destructive-foreground disabled:opacity-50"
                >
                  Auto-fix
                </button>
              </div>
            )}

            <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
              {project && pane !== "chat" && (
                <aside className="max-h-56 overflow-auto rounded-2xl border border-border bg-card p-2 text-xs lg:max-h-[70vh]">
                  <p className="px-2 pb-1 font-semibold text-muted-foreground">Project files</p>
                  <FileTree
                    nodes={tree}
                    active={currentFile?.path ?? null}
                    onSelect={(p) => {
                      setActiveFile(p);
                      setPane("code");
                    }}
                  />
                </aside>
              )}

              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                {busy && pane !== "chat" ? (
                  <div className="flex h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
                    <Loader2 className="size-6 animate-spin text-primary" />
                    {status || "Working…"}
                    <div className="h-1 w-48 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
                    </div>
                  </div>
                ) : pane === "preview" ? (
                  <div className="flex justify-center bg-secondary/40 p-2">
                    <iframe
                      key={previewHtml.length}
                      title="App preview"
                      srcDoc={previewHtml}
                      sandbox="allow-scripts allow-forms allow-modals allow-popups"
                      style={{ width: DEVICE_WIDTH[device], maxWidth: "100%" }}
                      className="h-[70vh] rounded-xl border border-border bg-white"
                    />
                  </div>
                ) : pane === "code" ? (
                  <div className="flex h-[70vh] flex-col">
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
                      <FileCode2 className="size-3.5 text-primary" />
                      <span className="truncate font-medium">{currentFile?.path}</span>
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {currentFile ? language(currentFile.path) : ""}
                      </span>
                      <div className="flex-1" />
                      <button onClick={copyFile} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      </button>
                    </div>
                    <pre className="flex-1 overflow-auto p-4 text-xs leading-relaxed whitespace-pre text-card-foreground">
                      {currentFile?.content}
                    </pre>
                  </div>
                ) : (
                  <div className="flex h-[70vh] flex-col gap-3 overflow-auto p-4">
                    {buildLog.map((m) => (
                      <div
                        key={m.id}
                        className={
                          m.role === "user"
                            ? "self-end max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground"
                            : "self-start max-w-[92%] rounded-2xl rounded-bl-md border border-border bg-secondary/50 px-3 py-2 text-sm"
                        }
                      >
                        {m.content}
                      </div>
                    ))}
                    {busy && <p className="text-sm text-muted-foreground">{status}</p>}
                  </div>
                )}
              </div>
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

      <div className="sticky bottom-0 z-20 border-t border-border/60 bg-background/85 backdrop-blur-xl">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="mx-auto flex w-full max-w-7xl items-end gap-2 px-4 py-3"
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
                : project
                  ? "Describe a change — Velix rebuilds it live…"
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

      {deployOpen && project && (
        <DeployDialog project={project} onClose={() => setDeployOpen(false)} />
      )}
    </main>
  );
}

function FileTree({
  nodes,
  active,
  onSelect,
  depth = 0,
}: {
  nodes: TreeNode[];
  active: string | null;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  return (
    <ul>
      {nodes.map((node) =>
        node.children ? (
          <li key={node.path}>
            <div
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground"
              style={{ paddingLeft: 8 + depth * 10 }}
            >
              <ChevronRight className="size-3" />
              <Folder className="size-3.5" />
              {node.name}
            </div>
            <FileTree nodes={node.children} active={active} onSelect={onSelect} depth={depth + 1} />
          </li>
        ) : (
          <li key={node.path}>
            <button
              onClick={() => onSelect(node.path)}
              style={{ paddingLeft: 12 + depth * 10 }}
              className={`flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left ${
                active === node.path
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileCode2 className="size-3.5 shrink-0 text-primary" />
              <span className="truncate">{node.name}</span>
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

function DeployDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const [token, setToken] = useState("");
  const [siteName, setSiteName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");

  async function deploy() {
    if (!token.trim()) return setErr("Paste your Netlify personal access token.");
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, siteName: siteName.trim() || undefined, files: project.files }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Deploy failed");
      setUrl(data.url ?? "");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Deploy failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <Rocket className="size-4 text-primary" />
          <h2 className="flex-1 text-sm font-semibold">Host on Netlify</h2>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        {url ? (
          <div className="mt-4 space-y-3 text-sm">
            <p className="text-muted-foreground">Your app is live 🎉</p>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="block truncate rounded-lg border border-primary/50 bg-primary/10 px-3 py-2 text-primary"
            >
              {url}
            </a>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="block text-xs text-muted-foreground">
              Netlify personal access token
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                type="password"
                placeholder="nfp_…"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              Site name
              <input
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60"
              />
            </label>
            <p className="text-[11px] text-muted-foreground">
              Create a token at app.netlify.com → User settings → Applications → Personal access
              tokens. It is used only for this deploy and never stored.
            </p>
            {err && <p className="text-xs text-destructive">{err}</p>}
            <button
              onClick={() => void deploy()}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
              {busy ? "Deploying…" : "Deploy now"}
            </button>
          </div>
        )}
      </div>
    </div>
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
