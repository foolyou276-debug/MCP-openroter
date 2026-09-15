export interface Env {
  OPENROUTER_API_KEY: string;
  OPENROUTER_TITLE?: string;
  OPENROUTER_SITE_URL?: string;
}

const BASE = "https://openrouter.ai/api/v1";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: CORS });
}

async function orFetch(url: string, apiKey: string, siteUrl: string, title: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": siteUrl,
      "X-Title": title,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json<any>();
}

const TOOLS = [
  {
    name: "chat",
    description: "Send chat completion to any OpenRouter model",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string" },
        messages: { type: "array", items: { type: "object" } },
        system: { type: "string" },
        temperature: { type: "number" },
        max_tokens: { type: "number" },
      },
      required: ["model", "messages"],
    },
  },
  {
    name: "list_models",
    description: "List OpenRouter models",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string" },
        provider: { type: "string" },
        free_only: { type: "boolean" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "get_credits",
    description: "Check OpenRouter credits",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_providers",
    description: "List all providers with model counts",
    inputSchema: { type: "object", properties: {} },
  },
];

async function handleTool(name: string, args: any, env: Env): Promise<string> {
  const key = env.OPENROUTER_API_KEY;
  const site = env.OPENROUTER_SITE_URL ?? "https://github.com/r4xgamez";
  const title = env.OPENROUTER_TITLE ?? "OpenRouter MCP";
  const f = (url: string, init?: RequestInit) => orFetch(url, key, site, title, init);

  if (name === "chat") {
    const { model, messages, system, temperature = 0.7, max_tokens = 2000 } = args;
    const msgs = system ? [{ role: "system", content: system }, ...messages] : messages;
    const data = await f(`${BASE}/chat/completions`, {
      method: "POST",
      body: JSON.stringify({ model, messages: msgs, temperature, max_tokens }),
    });
    return JSON.stringify({ content: data.choices[0].message.content, model: data.model, usage: data.usage }, null, 2);
  }

  if (name === "list_models") {
    const { search = "", provider = "", free_only = false, limit = 50 } = args ?? {};
    const data = await f(`${BASE}/models`);
    let models: any[] = data.data ?? [];
    if (free_only) models = models.filter((m: any) => m.id?.includes(":free"));
    if (provider) models = models.filter((m: any) => m.id?.split("/")[0]?.toLowerCase().includes(provider.toLowerCase()));
    if (search) { const q = search.toLowerCase(); models = models.filter((m: any) => m.id?.toLowerCase().includes(q)); }
    return JSON.stringify({ count: models.length, models: models.slice(0, limit).map((m: any) => ({ id: m.id, name: m.name, context_length: m.context_length })) }, null, 2);
  }

  if (name === "get_credits") {
    const data = await f(`${BASE}/auth/key`);
    return JSON.stringify(data, null, 2);
  }

  if (name === "list_providers") {
    const data = await f(`${BASE}/models`);
    const counts: Record<string, number> = {};
    for (const m of data.data ?? []) { const p = m.id?.split("/")[0]; if (p) counts[p] = (counts[p] ?? 0) + 1; }
    return JSON.stringify(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([provider, model_count]) => ({ provider, model_count })), null, 2);
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function handleMCP(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("OpenRouter MCP ready", { status: 200, headers: CORS });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
  }

  const { method, params, id } = body;

  if (method === "initialize") {
    return json({
      jsonrpc: "2.0",
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "openrouter-mcp", version: "1.0.0" },
      },
      id,
    });
  }

  if (method === "tools/list") {
    return json({ jsonrpc: "2.0", result: { tools: TOOLS }, id });
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params ?? {};
    try {
      const result = await handleTool(name, args, env);
      return json({ jsonrpc: "2.0", result: { content: [{ type: "text", text: result }] }, id });
    } catch (e: any) {
      return json({ jsonrpc: "2.0", error: { code: -32000, message: e.message }, id });
    }
  }

  return json({ jsonrpc: "2.0", error: { code: -32601, message: "Method not found" }, id });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return handleMCP(request, env);
    }
    return new Response("OpenRouter MCP\n/mcp", { status: 200, headers: { "Content-Type": "text/plain", ...CORS } });
  },
};
