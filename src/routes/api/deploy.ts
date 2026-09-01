import { createFileRoute } from "@tanstack/react-router";

type DeployFile = { path: string; content: string };

const NETLIFY = "https://api.netlify.com/api/v1";

async function sha1(text: string) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/deploy")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as {
          token?: string;
          siteId?: string;
          siteName?: string;
          files?: DeployFile[];
        };

        const token = body.token?.trim();
        const files = Array.isArray(body.files) ? body.files : [];
        if (!token) return json({ error: "Netlify personal access token is required." }, 400);
        if (files.length === 0) return json({ error: "No project files to deploy." }, 400);

        const auth = { authorization: `Bearer ${token}` };

        try {
          // 1. resolve or create the site
          let siteId = body.siteId?.trim();
          let siteUrl = "";
          if (!siteId) {
            const res = await fetch(`${NETLIFY}/sites`, {
              method: "POST",
              headers: { ...auth, "content-type": "application/json" },
              body: JSON.stringify(body.siteName ? { name: body.siteName } : {}),
            });
            const site = (await res.json().catch(() => ({}))) as {
              id?: string;
              ssl_url?: string;
              url?: string;
              message?: string;
            };
            if (!res.ok || !site.id) {
              return json(
                { error: `Netlify site create failed (${res.status}). ${site.message ?? ""}` },
                res.status === 401 ? 401 : 502,
              );
            }
            siteId = site.id;
            siteUrl = site.ssl_url ?? site.url ?? "";
          }

          // 2. digest manifest
          const digests: Record<string, string> = {};
          const byHash = new Map<string, DeployFile>();
          for (const f of files) {
            const path = "/" + f.path.replace(/^\/+/, "");
            const hash = await sha1(f.content);
            digests[path] = hash;
            byHash.set(hash, f);
          }

          const depRes = await fetch(`${NETLIFY}/sites/${siteId}/deploys`, {
            method: "POST",
            headers: { ...auth, "content-type": "application/json" },
            body: JSON.stringify({ files: digests, async: false }),
          });
          const deploy = (await depRes.json().catch(() => ({}))) as {
            id?: string;
            required?: string[];
            ssl_url?: string;
            deploy_ssl_url?: string;
            message?: string;
          };
          if (!depRes.ok || !deploy.id) {
            return json(
              { error: `Netlify deploy failed (${depRes.status}). ${deploy.message ?? ""}` },
              502,
            );
          }

          // 3. upload required files
          for (const hash of deploy.required ?? []) {
            const file = byHash.get(hash);
            if (!file) continue;
            const path = "/" + file.path.replace(/^\/+/, "");
            const up = await fetch(
              `${NETLIFY}/deploys/${deploy.id}/files${path.split("/").map(encodeURIComponent).join("/")}`,
              {
                method: "PUT",
                headers: { ...auth, "content-type": "application/octet-stream" },
                body: file.content,
              },
            );
            if (!up.ok) {
              const detail = await up.text().catch(() => "");
              return json({ error: `Upload failed for ${path}: ${detail.slice(0, 200)}` }, 502);
            }
          }

          const url = deploy.ssl_url || deploy.deploy_ssl_url || siteUrl;
          return json({ url, siteId, deployId: deploy.id });
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Deploy failed" }, 500);
        }
      },
    },
  },
});
