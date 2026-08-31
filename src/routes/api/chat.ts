import { createFileRoute } from "@tanstack/react-router";

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

const SYSTEM_PROMPT =
  "You are Velix AI, a helpful, precise assistant. Answer accurately and concisely. If the user writes in Sinhala, reply in Sinhala.";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["AI_API_KEY"]?.trim() ?? process.env["DEEPSEEK_API_KEY"]?.trim();
        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: "AI_API_KEY is not configured." }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }

        const baseUrl = (process.env["AI_BASE_URL"] ?? "https://api.b.ai/v1").replace(/\/$/, "");
        const model = process.env["AI_MODEL"]?.trim() ?? "deepseek-v4-flash";

        const body = (await request.json()) as { messages?: ChatMessage[] };
        const messages = Array.isArray(body.messages) ? body.messages : null;
        if (!messages || messages.length === 0) {
          return new Response(JSON.stringify({ error: "messages are required" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const upstream = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            stream: false,
            temperature: 0.6,
            messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages.slice(-20)],
          }),
        });

        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => "");
          return new Response(
            JSON.stringify({
              error: `AI provider error (${upstream.status}). ${detail.slice(0, 300)}`,
            }),
            { status: upstream.status, headers: { "content-type": "application/json" } },
          );
        }

        const json = (await upstream.json().catch(() => ({}))) as {
          choices?: { message?: { content?: string } }[];
          error?: { message?: string };
        };
        const content = json.choices?.[0]?.message?.content;
        if (!content) {
          return new Response(
            JSON.stringify({ error: "No response from AI provider." }),
            { status: 502, headers: { "content-type": "application/json" } },
          );
        }

        return new Response(JSON.stringify({ content }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
