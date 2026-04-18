# CLAUDE.md

Project guidance for coding agents (Claude Code, Cursor, etc.). Read this before making changes. Keep it up to date when architecture shifts — future agents depend on it.

---

## Context

Teddy is a solo-founder AI startup. The owner is not a full-stack expert — they've chosen this stack because it minimizes moving parts. Prefer the conservative, well-documented path over clever one-offs. Explain tradeoffs when the owner asks.

The product itself is **not yet defined**. Everything in this repo is scaffold — auth, file upload, and a chat endpoint as a "hello world" for the AI integration. The owner will describe the product and features get built on top of this.

---

## Stack — what and why

| Concern | Tool | Why this, not alternatives |
| --- | --- | --- |
| Monorepo | pnpm + Turborepo | Lightweight, well-supported by Next.js/Expo; alternatives (Nx, Rush) are overkill |
| Web | Next.js 15 App Router | Server Components + built-in API routes = no separate backend needed |
| Mobile | Expo Router | Shares React mental model with web; avoids native toolchains for dev |
| DB / Auth / Storage | Supabase | Replaces ~3 services (Postgres, Clerk/Auth0, S3). RLS is the security model — lean on it |
| AI | OpenAI | Single provider for LLM + STT + TTS while validating the product. All calls go through `packages/ai` so the provider is swappable |
| Types | Shared via `packages/shared` | `@teddy/shared` holds Zod schemas; infer TS types from them |

**Do not** swap a layer without asking the owner. "Replace Supabase with Firebase" is a large decision with migration cost.

---

## Layout conventions

- `apps/*` — end-user apps (web, mobile). Each is its own package.
- `packages/*` — internal libraries. Named `@teddy/<name>`. Reference via `workspace:*`.
- `packages/shared` — only framework-agnostic code (types, Zod schemas, pure utils). No React, no Node-only APIs.
- `packages/ai` — OpenAI wrappers. Server-only. Reads `OPENAI_API_KEY` from `process.env`. Never import this from client components.
- `packages/supabase` — exports the `Database` type and a browser client factory. SSR client lives in `apps/web/src/lib/supabase/server.ts` (Next.js-specific; don't move to shared).
- `supabase/migrations/` — SQL files, timestamp-prefixed. All tables MUST have RLS policies.

---

## Environment

- Single `.env` at repo root. Each app has a symlink `.env → ../../.env`. Don't create per-app env files.
- `NEXT_PUBLIC_*` and `EXPO_PUBLIC_*` are duplicates of the same values — both runtimes strip their own prefix.
- `OPENAI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are **server-only**. If you add code that references either, verify it's running server-side (API route, Edge Function, server component) — NOT a `'use client'` component.

---

## Security defaults

- Every new table in `public` schema needs RLS policies before the migration is safe to run. Supabase has "automatic RLS" enabled at the project level as a safety net, but write explicit policies anyway — they document intent.
- Storage bucket access is controlled by path prefix. Pattern: `<user_id>/<filename>`; the policy checks `auth.uid()::text = (storage.foldername(name))[1]`.
- Never log request bodies or auth tokens.
- Zod-validate anything entering an API route (`parsed.success` check before touching the data).

---

## Code style

Follow the system prompt defaults:

- Default to **no comments**. Only comment non-obvious WHY.
- Don't add abstractions for hypothetical futures. 3 similar lines is fine.
- Don't add error handling for things that can't happen. Trust internal callers.
- Don't rename, restructure, or "clean up" unrelated code when making a targeted change.
- Prefer editing an existing file over creating a new one.
- Short variable/function names when scope is small; descriptive when exported.

TypeScript settings (`tsconfig.base.json`) use `strict: true` and `noUncheckedIndexedAccess: true`. Respect them — use `?.` and explicit undefined checks rather than `!`.

---

## Adding features — recipes

### A new Supabase table

1. Create `supabase/migrations/<yyyymmddhhmmss>_<name>.sql`.
2. `create table`, `alter table ... enable row level security`, `create policy ...`.
3. Apply via SQL Editor or `supabase db push`.
4. Update `packages/supabase/src/types.ts` — add the new Tables entry (or regenerate via `supabase gen types typescript --project-id <id>`).
5. Web/mobile get the types for free.

### A new AI call

1. Add a function in `packages/ai/src/<feature>.ts`. Take primitives/shared-types in, return primitives out.
2. Export from `packages/ai/src/index.ts`.
3. Call from `apps/web/src/app/api/<route>/route.ts` or a Supabase Edge Function. Validate the request with a Zod schema from `@teddy/shared`.
4. On the client, fetch the route. Stream responses when latency matters (chat), buffer for one-shot (TTS → audio blob).

### A new web page

1. Create `apps/web/src/app/<route>/page.tsx`.
2. Server component by default. Add `'use client'` only when you need hooks/state/effects.
3. For auth-gated pages, call `getServerSupabase()` and redirect if no user.

### A new mobile screen

1. Create `apps/mobile/app/<route>.tsx`.
2. Import `supabase` from `@/lib/supabase` for DB / auth.
3. For API calls back to web, use `apps/mobile/src/lib/api.ts` (reads `EXPO_PUBLIC_API_BASE`).

---

## Known gotchas

See `README.md` → Gotchas. Important ones:

- Env symlinks must exist — if a fresh clone fails with "URL and Key are required", recreate them.
- React 18 (mobile) vs 19 (web). Don't touch `.npmrc` hoist rules.
- `Database` type must include `__InternalSupabase: { PostgrestVersion: "12" }` for supabase-js 2.103+.
- Middleware is an Edge runtime — env vars are injected at build time, so changes to `.env` require a dev server restart.

---

## Verification before shipping a change

Run these and resolve errors before considering work done:

```bash
pnpm typecheck         # must pass all 5 packages
pnpm --filter @teddy/web build   # must succeed if web was touched
```

For UI changes, start `pnpm dev:web` and actually click through the affected flow. Typecheck verifies code, not features.

For mobile, `pnpm --filter @teddy/mobile typecheck` — full builds require Xcode/Android Studio, so only do them when shipping.

---

## Commits

- Use conventional-ish messages: short first line, blank line, then body explaining why.
- Don't commit `.env`. The `.gitignore` covers it; verify with `git status` before staging.
- Don't bypass hooks (`--no-verify`) unless the owner asks.
- New commits, not `--amend`, unless the owner explicitly asks to amend.

---

## Out of scope (don't do these unsolicited)

- Add monitoring / error tracking (Sentry, Datadog)
- Add testing framework
- Deploy to production
- Add payments (Stripe)
- Add a CI/CD pipeline
- Rearrange the monorepo layout
- Switch providers

Propose these when relevant, then wait for the owner to decide.
