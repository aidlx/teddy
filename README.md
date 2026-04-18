# Teddy

AI assistant for students. Capture what happens in class as free text — Teddy classifies it as a task or a note, links it to the right course, and pulls out due dates. Monorepo: web (Next.js), mobile (Expo, scaffolded only), shared packages wired to Supabase + OpenAI.

**Status:** V1 (web) shipped. Courses + typed capture + task/note lists working end-to-end. Mobile, voice capture, photo/OCR, and push notifications are deferred.

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

# 5. Database schema — uses Supabase CLI (already linked via supabase/config.toml)
brew install supabase/tap/supabase   # if you don't have it
supabase login                        # one-time, browser flow
pnpm db:push                          # applies any unapplied supabase/migrations/*.sql

# 6. Run
pnpm dev:web        # http://localhost:3000
pnpm dev:mobile     # Expo — scan QR with Expo Go, or press i / a for simulator
```

### Disable email confirmation (dev only)

Supabase dashboard → **Authentication → Providers → Email** → uncheck *Confirm email*. Signup then signs you in immediately. Re-enable before launch.

---

## What's wired up

**V1 — working:**

- Email + password signup / sign in — `apps/web/src/app/login/page.tsx`
- Courses CRUD — `apps/web/src/app/courses/page.tsx`
- Capture box (text) → AI parser → task or note — `apps/web/src/components/CaptureBox.tsx`, `packages/ai/src/parse.ts`, `apps/web/src/app/api/capture/route.ts`
- Home: overdue + open tasks + recent notes — `apps/web/src/app/page.tsx`
- Task list w/ filters (open/done/all, by course), toggle complete — `apps/web/src/app/tasks/page.tsx`
- Notes list w/ course filter — `apps/web/src/app/notes/page.tsx`
- Three V1 tables with RLS (`courses`, `tasks`, `notes`) — `supabase/migrations/20260418100000_v1_capture.sql`

**Scaffolded but dormant in V1:**

- Mobile app (`apps/mobile/`) — builds and runs, uses initial scaffold screens only
- `packages/ai` `transcribe()` (Whisper) and `speak()` (TTS) — for V2 voice capture
- `POST /api/chat` streaming endpoint and file upload — original scaffold, still functional
- Supabase Edge Function `supabase/functions/chat/`

**Deferred:**

- Voice capture (Whisper), photo / blackboard capture (OCR), push notifications
- Google / Apple SSO
- Collaboration, search over history
- Production deployment (Vercel / EAS), payments

---

## V1 feature surface

Three tables, one capture endpoint. See `CLAUDE.md` for implementation notes.

```
courses (owner_id)  ─┐
                     ├─  tasks (owner_id, course_id?, due_at, completed_at)
                     └─  notes (owner_id, course_id?, content)
```

**Capture flow:**

```
CaptureBox → POST /api/capture → parseCapture(text, {courses, now})
                                         │
                        GPT-4o-mini (JSON mode, temp 0.2)
                                         │
                     { type: 'task' | 'note', ...fields }
                                         │
                        insert into tasks OR notes
                                         │
                           router.refresh() on client
```

The parser gets the user's courses as hints and is instructed not to invent `course_id` values. The API route re-validates that any returned `course_id` actually belongs to the requester before inserting.

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
| `pnpm db:push` | Apply new migrations to the linked Supabase project |
| `pnpm db:diff` | Show pending schema changes vs. remote |
| `pnpm db:types` | Regenerate `packages/supabase/src/types.ts` from remote schema |

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

**New Supabase table:** create `supabase/migrations/<timestamp>_<name>.sql`, run `pnpm db:push`, then `pnpm db:types` to regenerate the TS types. Keep the `__InternalSupabase: { PostgrestVersion: "12" }` marker in `packages/supabase/src/types.ts` if the generator drops it.

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

- `CLAUDE.md` — project guidance for coding agents (architecture decisions, V1 surface, conventions)
- `.env.example` — required env vars
- `supabase/migrations/` — DB schema (init + V1 capture)
