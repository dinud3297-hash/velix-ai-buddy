import { createFileRoute } from "@tanstack/react-router";

type Part =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };
type ChatMessage = { role: "user" | "assistant" | "system"; content: string | Part[] };

const SYSTEM_PROMPT =
  "You are Velix AI, a helpful, precise assistant created by Velix. If anyone asks who made you, who your creator/developer/owner is, always answer that you were created by Velix. Never mention any other company or model provider. Answer accurately and concisely. If the user writes in Sinhala, reply in Sinhala. When an image is attached, scan it carefully and describe or extract exactly what is in it (text, objects, numbers, code, documents) before answering.";

const BUILDER_PROMPT = `You are Velix AI No-Code Builder, created by Velix. If anyone asks who made you, answer: Velix.
The user describes an app in plain language (English or Sinhala). You generate a COMPLETE, PRODUCTION-QUALITY, MULTI-FILE web project.

OUTPUT FORMAT — return ONLY one raw JSON object, no markdown fences, no text before or after:
{
  "name": "kebab-case-project-name",
  "summary": "one short sentence about what you built or changed",
  "entry": "index.html",
  "files": [ { "path": "index.html", "content": "..." }, { "path": "src/app.js", "content": "..." } ]
}

HARD RULES
1. "entry" MUST be "index.html" and it MUST run standalone in a browser iframe with no build step and no server.
2. Split the project into real files and folders (index.html, styles/*.css, src/*.js, components/*, assets, README.md). Never dump everything in one file unless the app is trivial.
3. Reference sibling files with relative paths: <link rel="stylesheet" href="styles/main.css"> and <script type="module" src="src/app.js"></script>. Only relative paths — never absolute local paths.
4. Allowed remote resources: https://cdn.tailwindcss.com, https://esm.sh/*, https://unpkg.com/*, Google Fonts, https://images.unsplash.com.
5. FRAMEWORKS: if the user asks for React / React Native / Vue / Svelte / TypeScript etc., still deliver a browser-runnable result:
   - React: <script type="importmap"> mapping react + react-dom/client to https://esm.sh/react@18 and https://esm.sh/react-dom@18/client, plus Babel standalone (https://unpkg.com/@babel/standalone/babel.min.js) and <script type="text/babel" data-type="module" src="src/App.jsx"></script>.
   - React Native: use react-native-web via https://esm.sh/react-native-web@0.19 with the same React setup, and ALSO include the idiomatic React Native source files so the code is copy-paste usable in a real RN project.
   - Vue: https://esm.sh/vue@3. Svelte/other: compile-free equivalent in the browser, plus the idiomatic source files.
   - TypeScript requests: include .ts/.tsx sources AND make index.html run them through Babel standalone (data-type="module", preset typescript).
6. QUALITY BAR: beautiful, modern, responsive UI; real working interactions and realistic demo data; keyboard + aria accessibility; empty/loading states; persist state to localStorage where it makes sense. No TODOs, no placeholders, no lorem ipsum, no broken handlers.
7. Every file you list must be complete. JSON must be strictly valid — escape newlines and quotes correctly inside "content".
8. When the user asks for a change, or when runtime errors are reported, return the FULL updated project again (all files), fixing the reported errors.`;

const WEB_PROMPT = `You are Velix AI Website Builder, created by Velix. If anyone asks who made you, answer: Velix.
The user describes a WEBSITE in plain language (English or Sinhala). You generate a complete, marketing-grade, MULTI-PAGE static website.

Use the exact same JSON output format and the same hard rules as the Velix app builder:
{ "name": "...", "summary": "...", "entry": "index.html", "files": [ { "path": "...", "content": "..." } ] }
Return ONLY raw JSON — no markdown fences, no commentary.

WEBSITE-SPECIFIC RULES
1. Produce real multi-page navigation: index.html plus pages like about.html, services.html, pricing.html, blog.html, contact.html — whichever fit the brief. Every nav link must point to a page you actually generated (relative paths only).
2. Shared styles/main.css and src/main.js across all pages; identical header and footer on each page with the current page highlighted.
3. Each page needs a unique <title>, meta description, Open Graph tags, one H1, semantic sections, and alt text on every image.
4. Design bar: distinctive modern visual identity (custom palette, Google Font pairing, generous spacing, gradients/glass/soft shadows used tastefully), hero with clear value proposition, feature grid, testimonials, FAQ accordion, pricing table, call-to-action band, real footer. Fully responsive with a working mobile hamburger menu.
5. Interactions must work: mobile menu toggle, smooth scroll, accordion, contact form validation with success state, scroll reveal animations, back-to-top.
6. Realistic industry-specific copy and images from https://images.unsplash.com — no lorem ipsum, no placeholder text, no dead links.
7. When the user asks for a change, return the FULL updated site again (all files).`;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey =
          process.env["AI_API_KEY"]?.trim() ?? process.env["DEEPSEEK_API_KEY"]?.trim();
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "AI_API_KEY is not configured." }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }

        const baseUrl = (process.env["AI_BASE_URL"] ?? "https://api.b.ai/v1").replace(/\/$/, "");
        const model = process.env["AI_MODEL"]?.trim() ?? "deepseek-v4-flash";

        const body = (await request.json()) as { messages?: ChatMessage[]; mode?: string };
        const messages = Array.isArray(body.messages) ? body.messages : null;
        if (!messages || messages.length === 0) {
          return new Response(JSON.stringify({ error: "messages are required" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const mode = body.mode === "builder" ? "builder" : body.mode === "web" ? "web" : "chat";
        const isBuilder = mode !== "chat";
        const system = mode === "builder" ? BUILDER_PROMPT : mode === "web" ? WEB_PROMPT : SYSTEM_PROMPT;

        const upstream = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            // Streaming makes chat answers appear almost instantly; builder stays buffered
            // because the client needs the whole JSON project before it can parse it.
            stream: !isBuilder,
            temperature: isBuilder ? 0.3 : 0.5,
            max_tokens: isBuilder ? 16000 : 1200,
            messages: [{ role: "system", content: system }, ...messages.slice(-14)],
          }),
        });

        if (!upstream.ok || !upstream.body) {
          const detail = await upstream.text().catch(() => "");
          return new Response(
            JSON.stringify({
              error: `AI provider error (${upstream.status}). ${detail.slice(0, 300)}`,
            }),
            { status: upstream.status || 502, headers: { "content-type": "application/json" } },
          );
        }

        if (!isBuilder) {
          // Re-emit only the plain text deltas as a raw text stream: simplest possible
          // transport for the browser and it starts painting on the first token.
          const decoder = new TextDecoder();
          const encoder = new TextEncoder();
          const reader = upstream.body.getReader();
          let buffer = "";

          const stream = new ReadableStream<Uint8Array>({
            async pull(controller) {
              const { done, value } = await reader.read();
              if (done) {
                controller.close();
                return;
              }
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const payload = trimmed.slice(5).trim();
                if (!payload || payload === "[DONE]") continue;
                try {
                  const json = JSON.parse(payload) as {
                    choices?: { delta?: { content?: string } }[];
                  };
                  const delta = json.choices?.[0]?.delta?.content;
                  if (delta) controller.enqueue(encoder.encode(delta));
                } catch {
                  /* ignore keep-alive / partial frames */
                }
              }
            },
            cancel() {
              void reader.cancel();
            },
          });

          return new Response(stream, {
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "no-cache",
              "x-accel-buffering": "no",
            },
          });
        }

        const json = (await upstream.json().catch(() => ({}))) as {
          choices?: { message?: { content?: string } }[];
        };
        const content = json.choices?.[0]?.message?.content;
        if (!content) {
          return new Response(JSON.stringify({ error: "No response from AI provider." }), {
            status: 502,
            headers: { "content-type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ content }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
