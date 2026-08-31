import { createFileRoute } from "@tanstack/react-router";

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

const SYSTEM_PROMPT =
  "You are Velix AI, a helpful, precise assistant. Answer accurately and concisely. If the user writes in Sinhala, reply in Sinhala.";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawKey = process.env["DEEPSEEK_API_KEY"];
        const apiKey = rawKey?.trim();
        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: "DEEPSEEK_API_KEY is not configured." }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
        if (!apiKey.startsWith("sk-")) {
          return new Response(
            JSON.stringify({
              error:
                "The stored API key does not look like a DeepSeek key (it should start with sk-). If you have an OpenRouter key, please tell me so I can switch the endpoint.",
            }),
            { status: 401, headers: { "content-type": "application/json" } },
          );
        }

        const body = (await request.json()) as { messages?: ChatMessage[] };
        const messages = Array.isArray(body.messages) ? body.messages : null;
        if (!messages || messages.length === 0) {
          return new Response(JSON.stringify({ error: "messages are required" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const upstream = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            stream: true,
            temperature: 0.6,
            messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages.slice(-20)],
          }),
        });

        if (!upstream.ok || !upstream.body) {
          const detail = await upstream.text().catch(() => "");
          return new Response(
            JSON.stringify({
              error: `AI provider error (${upstream.status}). ${detail.slice(0, 300)}`,
            }),
            { status: upstream.status, headers: { "content-type": "application/json" } },
          );
        }

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
              const data = trimmed.slice(5).trim();
              if (data === "[DONE]") continue;
              try {
                const json = JSON.parse(data);
                const delta = json?.choices?.[0]?.delta?.content;
                if (delta) controller.enqueue(encoder.encode(delta));
              } catch {
                // ignore partial/keepalive frames
              }
            }
          },
          cancel(reason) {
            return reader.cancel(reason);
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-cache",
          },
        });
      },
    },
  },
});
