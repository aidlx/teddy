# Teddy

An AI startup monorepo. Web (Next.js) + mobile (Expo React Native) + Supabase (Postgres, auth, storage) + OpenAI (GPT, Whisper, TTS).

```
teddy/
├─ apps/
│  ├─ web/              Next.js 15 (App Router, Tailwind)
│  └─ mobile/           Expo Router (React Native)
├─ packages/
│  ├─ shared/           Types + Zod schemas used by web and mobile
│  ├─ ai/               OpenAI wrappers: chat, Whisper (STT), TTS
│  └─ supabase/         Shared Supabase client + DB types
└─ supabase/
   ├─ migrations/       SQL schema (run on your Supabase project)
   └─ functions/        Edge Function that proxies chat to OpenAI
```

## Before you touch code — create accounts

Do these in order. Each takes a few minutes.

1. **GitHub** — https://github.com/join (your repo host).
2. **Supabase** — https://supabase.com → *New project*. Copy `Project URL`, `anon public key`, and `service_role key` from **Settings → API**. Keep the service role key secret — it bypasses RLS.
3. **OpenAI** — https://platform.openai.com → *API keys* → *Create new key*. Add a payment method; without one, calls fail.

## Install dependencies

```bash
# Install pnpm (if you haven't)
corepack enable && corepack prepare pnpm@latest --activate

# Install everything
pnpm install
```

## Configure environment

```bash
cp .env.example .env
```

Fill in:
- `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` → from Supabase **Settings → API**
- `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` → same values as above
- `SUPABASE_SERVICE_ROLE_KEY` → from Supabase **Settings → API** (server-only)
- `OPENAI_API_KEY` → from OpenAI dashboard (server-only)

## Apply the database schema

Option A (simplest) — copy `supabase/migrations/20260418000000_init.sql` into the Supabase **SQL Editor** and run it.

Option B (recommended once you're comfortable) — use the Supabase CLI:

```bash
brew install supabase/tap/supabase          # install CLI
supabase link --project-ref YOUR_REF        # from Settings → General
supabase db push                            # applies migrations/ to remote
```

## Enable SSO providers

In Supabase dashboard → **Authentication → Providers**:

- **Google** — toggle on. Follow the guide to create OAuth credentials in Google Cloud Console, paste Client ID + Secret. Add redirect URL shown by Supabase to your Google OAuth consent screen.
- **Apple** — toggle on. Required for iOS App Store if you use any other SSO. Needs an Apple Developer account ($99/yr) and a Services ID. Can be added later before mobile launch.

Add these **Redirect URLs** in Supabase **Authentication → URL Configuration**:
- `http://localhost:3000/auth/callback` (web dev)
- `teddy://auth/callback` (mobile)
- Your production web URL once deployed

## Run the web app

```bash
pnpm dev:web
# → http://localhost:3000
```

## Run the mobile app

```bash
pnpm dev:mobile
```

Expo will print a QR code. Options:
- **Expo Go app** (iOS/Android) — scan the QR code. Fastest way to test.
- **iOS Simulator** — requires Xcode. Press `i` in the Expo terminal.
- **Android Emulator** — requires Android Studio. Press `a`.

The mobile app calls the web app's `/api/chat` route for LLM requests. For local dev, run both `pnpm dev:web` and `pnpm dev:mobile` side by side, and set `EXPO_PUBLIC_API_BASE` in `.env` to your LAN IP (e.g. `http://192.168.1.10:3000`) so your phone can reach your laptop.

## Push to GitHub

```bash
cd /Users/aidlx/Repos/teddy
git init
git add .
git commit -m "Initial scaffold"
gh repo create teddy --private --source=. --push       # needs gh CLI
# or create the repo manually on github.com and:
#   git remote add origin git@github.com:<you>/teddy.git
#   git branch -M main
#   git push -u origin main
```

## What's wired up

- **Web + mobile auth** — email magic link, Google SSO, Apple SSO (web uses Supabase SSR; mobile uses AsyncStorage + `expo-auth-session`).
- **File storage** — `user-files` bucket with per-user RLS; upload UI on both platforms.
- **Chat** — `/api/chat` on web proxies to OpenAI GPT with streaming. Mobile calls that endpoint. Swap for the Supabase edge function in `supabase/functions/chat/` if you prefer the mobile app to bypass the Next.js server.
- **STT / TTS** — `packages/ai` exports `transcribe()` (Whisper) and `speak()` (OpenAI TTS). Not yet hooked up to a UI — add a screen/page when you design the voice feature.

## What's NOT done yet

- Production deployment (Vercel for web, EAS for mobile builds)
- Payments / billing (Stripe)
- Email templates for magic links (customize in Supabase dashboard)
- Push notifications
- The actual product — describe your app idea and we'll build features on top of this scaffold.

## Useful commands

```bash
pnpm dev            # run everything in parallel
pnpm dev:web        # web only
pnpm dev:mobile     # mobile only
pnpm typecheck      # TypeScript across all packages
pnpm build          # production build (web)
pnpm lint           # lint all packages
```
