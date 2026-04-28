# Client Onboarding Strategy

This monorepo powers a client onboarding and strategy workflow:
- a frontend app for onboarding clients and managing strategy work
- an API server that stores client/profile/strategy data
- shared libraries for API contracts, DB access, and generated client hooks

## Repository layout

- `artifacts/strategy-engine`: React + Vite frontend (primary app)
- `artifacts/api-server`: Express API backend
- `artifacts/mockup-sandbox`: design sandbox (non-primary runtime)
- `lib/api-client-react`: generated API hooks and fetch client used by frontend
- `lib/api-zod`: shared request/response schemas and validation contracts
- `lib/db`: Drizzle + Postgres DB layer (schema + DB client)
- `attached_assets`: static assets referenced by frontend

## Tech stack

- Frontend: React, Vite, Wouter, TanStack Query, Tailwind CSS
- Backend: Express, Drizzle ORM, Postgres, Pino logging
- Tooling: pnpm workspaces, TypeScript, esbuild

## Runtime architecture

- Frontend runs on `http://localhost:5174/content-calendar/` (isolated profile)
- Frontend API calls use `/api/*`
- Vite dev proxy forwards `/api` and `/content-calendar/api` to backend at `http://127.0.0.1:3001`
- Backend serves API routes under `/api`
- Backend enforces `x-api-key` on all `/api/*` routes
- Backend requires `DATABASE_URL` for startup

## Key user flows

- Dashboard lists clients (`GET /api/clients`)
- Create Client dialog creates client (`POST /api/clients`)
- Workspace shows strategy data per client
- Calendar view manages scheduled/generated post plan data

## Environment variables

### Frontend (`artifacts/strategy-engine/.env.local`)

- `PORT=5174`
- `BASE_PATH=/content-calendar/`
- `VITE_API_URL=http://localhost:3001/api`

### Backend (`artifacts/api-server/.env.local`)

- `PORT=3001`
- `DATABASE_URL` (required, Postgres connection string — see production checklist below)
- `LOCAL_API_KEY=sk-content-calendar-test-2026` (must match frontend proxy / client `x-api-key`)
- `NODE_ENV=development`

#### AI provider (strategy + calendar generation)

Choose the LLM backend with **`AI_PROVIDER`** (default: `openai`) and optionally override from the app-level **AI Settings** dialog.

| `AI_PROVIDER` | Required environment variables | Optional model override |
|---------------|-------------------------------|-------------------------|
| `openai` | `AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY` | `AI_MODEL_OPENAI` (default `gpt-5.2`) |
| `claude` | `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | `AI_MODEL_CLAUDE` (default `claude-3-5-sonnet-20241022`), `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` (default `https://api.anthropic.com`) |
| `codex` | `AI_INTEGRATIONS_CODEX_BASE_URL`, `AI_INTEGRATIONS_CODEX_API_KEY` (OpenAI-compatible **Chat Completions** HTTP API) | `AI_MODEL_CODEX` (default `gpt-4o-mini`) |
| `perplexity` | `PERPLEXITY_API_KEY` (or `AI_INTEGRATIONS_PERPLEXITY_API_KEY`) | `x-ai-model` header from UI settings (default `sonar-pro`) |

Additional AI runtime flags:

| Variable | Purpose |
|----------|---------|
| `USE_REAL_AI` | `true/false`. If `false`, strategy/calendar generation intentionally uses demo content fallback. |
| `PERPLEXITY_API_KEY` | Preferred direct Perplexity key for production MVP. |

- **OpenAI-compatible gateways** (LM Studio, vLLM, Azure OpenAI-style proxies, etc.): use `AI_PROVIDER=openai` or `codex` and point `*_BASE_URL` + `*_API_KEY` at that gateway; set `AI_MODEL_*` to the model id your server exposes.
- **Codex path**: intended for a second OpenAI-compatible endpoint (different base URL, key, or model) without changing application code.

Without `DATABASE_URL`, the `@workspace/db` module throws at process start; use a valid Postgres URL for production.

### End-to-end tests (Playwright)

- Install browser: `npx pnpm run test:e2e:install` (or `npx pnpm exec playwright install chromium`)
- Run with **API + Vite dev servers already listening** on `3001` / `5174` (see `start:isolated`), same as manual QA.
- Optional overrides:
  - `E2E_BASE_URL` (default `http://localhost:5174/content-calendar/`)
  - `E2E_API_URL` (default `http://127.0.0.1:3001/api`)
  - `E2E_API_KEY` (default `sk-content-calendar-test-2026`)
- Run: `npx pnpm run test:e2e`
- In **CI** (`CI` or `GITHUB_ACTIONS` set): tests get **2 retries**, **blob** reporter output under `blob-report/` (merge with `npx playwright merge-reports --reporter=html ./blob-report`), and **traces on first retry**.

## Production deployment

### Process layout

- **API**: Node process from `artifacts/api-server` (build: `pnpm --filter @workspace/api-server run build`, run `node ./dist/index.mjs` or your process manager).
- **Frontend**: Static build from `artifacts/strategy-engine` (`pnpm --filter @workspace/strategy-engine run build`); serve `dist/public` behind your CDN or reverse proxy.
- **Base path**: If not served at `/`, set `BASE_PATH` at build time for the frontend and align public URLs.
- **Secrets**: Never commit `.env.local`. Use your host’s secret store for `DATABASE_URL`, API keys, and AI credentials.

### Production environment checklist

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres (managed Supabase/RDS/etc.). Use the **session** or **direct** connection string if the pooler rejects prepared statements; confirm **password** and **SSL** (`rejectUnauthorized` may be tuned per your CA). |
| `LOCAL_API_KEY` | Shared secret; required on every `/api/*` request as header `x-api-key`. |
| `AI_PROVIDER` | `openai` \| `claude` \| `codex` |
| Provider keys / URLs | Per table above for the chosen `AI_PROVIDER`. |
| `NODE_ENV=production` | Standard production mode. |
| `PORT` | API listen port. |

### Database (Supabase-style) auth checklist

1. Copy the connection string from the provider UI (often **URI** mode with password).
2. If you see `password authentication failed for user "postgres"`:
   - Verify the password was rotated and the string is updated everywhere.
   - Try **port 5432** (direct) vs **6543** (pooler) depending on provider docs.
3. Run migrations / schema push from a trusted machine: `pnpm --filter @workspace/db run push` with the same `DATABASE_URL` the API will use.
4. Confirm `GET /api/healthz` returns `"mode":"db"` and `"persistence":"persistent"` when the database is reachable.

### Team handoff (short)

1. Clone repo, `npx pnpm install`, copy `.env.local` examples into `artifacts/api-server/.env.local` and `artifacts/strategy-engine/.env.local`.
2. Set `DATABASE_URL`, `LOCAL_API_KEY`, and AI variables; choose `AI_PROVIDER`.
3. `pnpm run start:isolated` (or start API + UI separately as in Local development).
4. Run `pnpm run typecheck` and `pnpm run test:e2e` before merging risky changes.
5. Read `reports/production-readiness.md` for readiness gates and Playwright/blob CI notes.

## AI settings in UI

- On the dashboard, click **AI Settings**.
- You can:
  - toggle **Use real AI generation**
  - select provider (`perplexity`, `openai`, `claude`, `codex`)
  - set an optional API key and model override
- Settings are stored in browser local storage and sent as request headers to strategy/calendar generation endpoints.
- If real AI fails (missing/invalid key, provider error), the app falls back to demo content and shows a demo-content runtime banner.

## Local development (Windows / PowerShell, isolated)

From repo root:

1) Install dependencies:
- `npx pnpm install`

2) Start backend (Terminal 1):
- `$env:PORT=3001`
- `$env:DATABASE_URL="<your-postgres-connection-string>"`
- `$env:LOCAL_API_KEY="sk-content-calendar-test-2026"`
- `npx pnpm --filter @workspace/api-server run dev`

3) Start frontend (Terminal 2):
- `$env:PORT=5174`
- `$env:BASE_PATH='/content-calendar/'`
- `npx pnpm --filter @workspace/strategy-engine run dev`

Then open:
- `http://localhost:5174/content-calendar/`

## Common local issues

- `Could not create client` / API 500 in frontend:
  - backend is not running, DB is not configured, or API key is missing/mismatched
  - verify backend on `:3001`, `DATABASE_URL` is set, and `LOCAL_API_KEY` matches
- Vite proxy errors (`ECONNREFUSED 127.0.0.1:3001`):
  - frontend cannot reach backend; start backend first
- Missing styling in UI:
  - frontend serves but utility CSS may not be generated in certain local setups
  - ensure frontend is running from repo root with correct env values

## Scripts (root)

- `pnpm run build`: typecheck libs and build workspace packages
- `pnpm run typecheck`: full workspace typecheck
- `pnpm run kill-ports`: kill common frontend/backend dev ports
- `pnpm run start:isolated`: start backend + frontend in isolated port profile
- `pnpm run test:e2e`: Playwright regression suite (requires running API + frontend)
- `pnpm run test:e2e:ci`: same runner; in CI, retries/blob/trace behavior comes from `playwright.config.ts`
- `pnpm run test:e2e:install`: install Playwright browser binaries

## Notes

- This project was initially bootstrapped in a Replit-oriented setup.
- Core runtime now works as a standard local workspace with pnpm + env-based startup.
- Production MVP supports both:
  - **Real AI mode** (provider-backed generation)
  - **Demo mode** (deterministic fallback content, share-safe)
