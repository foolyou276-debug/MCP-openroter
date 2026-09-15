import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface Env {
  OPENROUTER_API_KEY: string;
  OPENROUTER_TITLE?: string;
  OPENROUTER_SITE_URL?: string;
  MCP_AGENT: DurableObjectNamespace;
}

const BASE = "https://openrouter.ai/api/v1";

export class OpenRouterMCP extends McpAgent<Env> {
  server = new McpServer({ name: "openrouter", version: "1.0.0" });

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": this.env.OPENROUTER_SITE_URL ?? "https://github.com/r4xgamez",
      "X-Title": this.env.OPENROUTER_TITLE ?? "OpenRouter MCP",
      "Content-Type": "application/json",
    };
  }

  private async orFetch(url: string, init?: RequestInit) {
    const res = await fetch(url, { ...init, headers: this.headers() });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text().catch(() => "")}`);
    return res.json<any>();
  }

  async init() {
    this.server.tool("chat", "Send chat completion to any OpenRouter model", {
      model: z.string(),
      messages: z.array(z.object({ role: z.enum(["user","assistant","system"]), content: z.union([z.string(), z.array(z.any())]) })),
      system: z.string().optional().default(""),
      temperature: z.number().min(0).max(2).optional().default(0.7),
      max_tokens: z.number().positive().optional().default(2000),
    }, async ({ model, messages, system, temperature, max_tokens }) => {
      const msgs = system ? [{ role: "system" as const, content: system }, ...messages] : messages;
      const data = await this.orFetch(`${BASE}/chat/completions`, {
        method: "POST",
        body: JSON.stringify({ model, messages: msgs, temperature, max_tokens }),
      });
      return { content: [{ type: "text" as const, text: JSON.stringify({ content: data.choices[0].message.content, model: data.model, usage: data.usage, generation_id: data.id }, null, 2) }] };
    });

    this.server.tool("list_models", "List OpenRouter models", {
      search: z.string().optional().default(""),
      provider: z.string().optional().default(""),
      free_only: z.boolean().optional().default(false),
      limit: z.number().min(1).max(200).optional().default(50),
    }, async ({ search, provider, free_only, limit }) => {
      const data = await this.orFetch(`${BASE}/models`);
      let models: any[] = data.data ?? [];
      if (free_only) models = models.filter(m => m.id?.includes(":free"));
      if (provider) models = models.filter(m => m.id?.split("/")[0]?.toLowerCase().includes(provider.toLowerCase()));
      if (search) { const q = search.toLowerCase(); models = models.filter(m => m.id?.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q)); }
      const result = models.slice(0, limit).map(m => ({ id: m.id, name: m.name, context_length: m.context_length, prompt_price_per_1k: parseFloat(m.pricing?.prompt ?? "0") * 1000, completion_price_per_1k: parseFloat(m.pricing?.completion ?? "0") * 1000 }));
      return { content: [{ type: "text" as const, text: JSON.stringify({ count: result.length, models: result }, null, 2) }] };
    });

    this.server.tool("get_model", "Get full details of a model", { model_id: z.string() }, async ({ model_id }) => {
      const data = await this.orFetch(`${BASE}/models`);
      const model = (data.data ?? []).find((m: any) => m.id === model_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(model ?? { error: `Model '${model_id}' not found` }, null, 2) }] };
    });

    this.server.tool("get_credits", "Check OpenRouter credits", {}, async () => {
      const data = await this.orFetch(`${BASE}/auth/key`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    });

    this.server.tool("get_generation", "Get stats for a past generation", { generation_id: z.string() }, async ({ generation_id }) => {
      const data = await this.orFetch(`${BASE}/generation?id=${generation_id}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    });

    this.server.tool("list_providers", "List all providers with model counts", {}, async () => {
      const data = await this.orFetch(`${BASE}/models`);
      const counts: Record<string, number> = {};
      for (const m of data.data ?? []) { const p = m.id?.split("/")[0]; if (p) counts[p] = (counts[p] ?? 0) + 1; }
      return { content: [{ type: "text" as const, text: JSON.stringify(Object.entries(counts).sort((a,b) => b[1]-a[1]).map(([provider, model_count]) => ({ provider, model_count })), null, 2) }] };
    });
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const url = new URL(request.url);
    const base = `${url.protocol}//${url.host}`;

    // OAuth metadata
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return Response.json({
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
      });
    }

    // Passthrough OAuth — no real user auth needed (API key is server-side secret)
    if (url.pathname === "/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      const state = url.searchParams.get("state") ?? "";
      const code = crypto.randomUUID();
      return Response.redirect(`${redirectUri}?code=${code}&state=${state}`);
    }

    if (url.pathname === "/token") {
      return Response.json({
        access_token: crypto.randomUUID(),
        token_type: "Bearer",
        expires_in: 86400,
      });
    }

    if (url.pathname === "/sse" || url.pathname.startsWith("/sse/")) {
      return OpenRouterMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    if (url.pathname === "/mcp") {
      return OpenRouterMCP.serve("/mcp").fetch(request, env, ctx);
    }

    return new Response("OpenRouter MCP\n/sse  SSE transport\n/mcp  HTTP transport", {
      status: 200, headers: { "Content-Type": "text/plain" },
    });
  },
};
