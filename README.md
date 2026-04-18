# Teddy

AI startup scaffold — a monorepo with web (Next.js), mobile (Expo React Native), and shared packages wired to Supabase + OpenAI.

**Status:** scaffold only. Auth, file storage, and AI chat are validated end-to-end. The product itself isn't defined yet.

---

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Monorepo | pnpm workspaces + Turborepo | Node-native, minimal, good incremental builds |
| Web | Next.js 15 (App Router) + Tailwind | React 19, Server Components, built-in API routes |
| Mobile | Expo Router (React Native) | One codebase for iOS + Android, no native build setup required for dev |
| Auth + DB + Storage | Supabase | Postgres + auth + S3-like storage + RLS in one service |
| AI | OpenAI (GPT, Whisper, TTS) | Single provider covers LLM + STT + TTS; easy to start |
| Types | TypeScript everywhere | Shared types via `packages/shared` |

Decisions are documented in `CLAUDE.md`. Swap providers by editing `packages/ai/` — nothing else needs to change.

---

## Repo layout

```
teddy/
├─ apps/
│  ├─ web/              Next.js 15 (App Router, Tailwind)
│  └─ mobile/           Expo Router (iOS/Android)
├─ packages/
│  ├─ shared/           Types + Zod schemas consumed by web + mobile
│  ├─ ai/               OpenAI wrappers (chat, Whisper, TTS)
│  └─ supabase/         Database type + client factory for web + mobile
├─ supabase/
│  ├─ migrations/       SQL files applied to the Supabase project
│  └─ functions/        Optional Edge Functions (e.g. chat proxy)
├─ .env                 Root env file — SYMLINKED into each app
├─ .env.example         Template
├─ .npmrc               pnpm hoist rules (isolates React 18 vs 19)
├─ turbo.json           Turbo pipelines
└─ pnpm-workspace.yaml  Declares apps/* and packages/* as workspaces
```

---

## Quickstart

```bash
# 1. Install pnpm (if needed)
corepack enable && corepack prepare pnpm@latest --activate

# 2. Install deps
pnpm install

# 3. Create accounts
#    - GitHub (you already have this)
#    - Supabase  → https://supabase.com (new project)
#    - OpenAI    → https://platform.openai.com/api-keys

# 4. Env
cp .env.example .env
# Edit .env — fill in Supabase URL + keys + OpenAI key.
# Each app/* has an .env symlink pointing at this root file; don't create per-app envs.

# 5. Database schema
# Either: copy supabase/migrations/20260418000000_init.sql into Supabase SQL Editor, run it.
# Or:     supabase link --project-ref <ref> && supabase db push

# 6. Run
pnpm dev:web        # http://localhost:3000
pnpm dev:mobile     # Expo — scan QR with Expo Go, or press i / a for simulator
```

### Disable email confirmation (dev only)

Supabase dashboard → **Authentication → Providers → Email** → uncheck *Confirm email*. Signup then signs you in immediately. Re-enable before launch.

---

## What's wired up

**Working and validated:**

- Email + password signup / sign in (web) — `apps/web/src/app/login/page.tsx`
- OpenAI GPT streaming chat — `POST /api/chat` → `apps/web/src/app/api/chat/route.ts`
- File upload to Supabase Storage with per-user RLS — `apps/web/src/app/files/page.tsx`
- Session-aware middleware for Supabase SSR — `apps/web/src/middleware.ts`
- Auto-create profile row on signup (SQL trigger in `supabase/migrations/…_init.sql`)

**Built but not validated end-to-end:**

- Mobile: email signin, file upload, chat screen — `apps/mobile/app/*`
- `packages/ai/` transcribe() (Whisper) + speak() (OpenAI TTS) — no UI yet
- Supabase Edge Function `supabase/functions/chat/` — optional OpenAI proxy for mobile

**Not done:**

- Google / Apple SSO (code paths exist, providers not enabled in Supabase dashboard)
- Production deployment (Vercel for web, EAS for mobile)
- Payments / billing
- Push notifications
- The actual product

---

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run all `dev` scripts in parallel (web + mobile) |
| `pnpm dev:web` | Web only — http://localhost:3000 |
| `pnpm dev:mobile` | Mobile only — Expo dev server |
| `pnpm build` | Production build (web) |
| `pnpm typecheck` | `tsc --noEmit` across all packages |
| `pnpm lint` | Lint all packages |

Per-package: `pnpm --filter @teddy/web <script>` or `pnpm --filter @teddy/mobile <script>`.

---

## Gotchas

These tripped us up during setup; documenting so future-you (or any agent) can skip the debugging.

**Env files are symlinked.** Next.js + Expo only read `.env` from each app's own directory, not the monorepo root. We symlink `apps/web/.env` → `../../.env` so there's one source of truth. If a symlink goes missing, recreate it:

```bash
ln -sfn ../../.env apps/web/.env
ln -sfn ../../.env apps/mobile/.env
```

**React 18 vs 19.** Mobile is on React 18 (Expo 52 constraint), web is on React 19. `.npmrc` has `public-hoist-pattern[]=!@types/react` etc. so the type packages stay isolated per app. Don't remove these lines — they prevent TypeScript errors.

**Supabase Database type needs `__InternalSupabase: { PostgrestVersion: "12" }`.** This is how `@supabase/supabase-js` 2.103+ picks schema version. If you run `supabase gen types typescript`, paste the output over `packages/supabase/src/types.ts` and keep this marker.

**Mobile → web API calls.** Mobile chat screen calls `http://localhost:3000/api/chat`. When testing on a phone, set `EXPO_PUBLIC_API_BASE` in `.env` to your laptop's LAN IP (e.g. `http://192.168.1.10:3000`), otherwise the phone can't reach `localhost`.

**Turbopack + Edge runtime env loading.** Don't use `loadEnvConfig` from `@next/env` in `next.config.mjs` — it doesn't populate the Edge runtime bundle reliably. The symlink approach is what actually works.

---

## Adding things

**New Supabase table:** create `supabase/migrations/<timestamp>_<name>.sql`, run it in the SQL editor or via `supabase db push`, then update `packages/supabase/src/types.ts` (regenerate via `supabase gen types typescript` once CLI is linked).

**New AI feature:** add a function in `packages/ai/src/<feature>.ts`, export from `packages/ai/src/index.ts`. Call it from an API route (web) or Supabase Edge Function (mobile). Never import `packages/ai` into client-side code — the OpenAI key lives server-side only.

**New shared type:** add to `packages/shared/src/types.ts` or `schemas.ts`. Both apps auto-pick it up.

**New web route:** create a folder under `apps/web/src/app/`. App Router conventions apply (`page.tsx`, `layout.tsx`, `route.ts`).

**New mobile route:** create a file under `apps/mobile/app/`. Expo Router is file-based.

---

## Pushing to GitHub

Repo is at https://github.com/aidlx/teddy.

```bash
git add .
git commit -m "your message"
git push
```

---

## See also

- `CLAUDE.md` — project guidance for coding agents (architecture decisions, conventions, where to put things)
- `.env.example` — required env vars
- `supabase/migrations/20260418000000_init.sql` — DB schema
