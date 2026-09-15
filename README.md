# OpenRouter MCP — Cloudflare Workers

## Deploy karo (ek baar)

```bash
# 1. deps install
npm install

# 2. Cloudflare login
npx wrangler login

# 3. API key secret set karo (secure)
npx wrangler secret put OPENROUTER_API_KEY
# prompt aayega → sk-or-... paste karo

# 4. Deploy
npm run deploy
```

URL milega:
```
https://openrouter-mcp.<your-subdomain>.workers.dev
```

---

## Claude.ai mein connect karo

Settings → MCP Servers → Add:
```
https://openrouter-mcp.<your-subdomain>.workers.dev/sse
```

---

## Local dev

```bash
# .dev.vars file banao
echo 'OPENROUTER_API_KEY=sk-or-...' > .dev.vars

npm run dev
# localhost:8787/sse
```

---

## Tools

| Tool | Description |
|------|-------------|
| `chat` | Kisi bhi model se chat — images bhi |
| `list_models` | Models filter karo (free_only, provider, search) |
| `get_model` | Ek model ki full details |
| `get_credits` | Remaining credits check karo |
| `get_generation` | Past generation ka cost/stats |
| `list_providers` | Sab providers + model counts |

---

## Endpoints

| Path | Use |
|------|-----|
| `/sse` | Claude.ai SSE transport |
| `/mcp` | HTTP streamable transport |
| `/` | Health check |

---

## Vars (wrangler.toml)

| Var | Secret? | Default |
|-----|---------|---------|
| `OPENROUTER_API_KEY` | YES (`wrangler secret put`) | — |
| `OPENROUTER_TITLE` | no | OpenRouter MCP |
| `OPENROUTER_SITE_URL` | no | github.com/r4xgamez |
