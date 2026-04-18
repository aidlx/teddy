'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase/client';

type Mode = 'signin' | 'signup';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);

    const supabase = getBrowserSupabase();

    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${location.origin}/auth/callback` },
      });
      if (error) {
        setError(error.message);
      } else if (data.session) {
        router.replace('/');
        router.refresh();
      } else {
        setInfo('Check your email to confirm the account, then sign in.');
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
      } else {
        router.replace('/');
        router.refresh();
      }
    }

    setLoading(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-10">
      <Link href="/" className="flex items-center gap-2 self-start">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/10 ring-1 ring-amber-400/20">
          <span className="text-base" aria-hidden>
            🧸
          </span>
        </span>
        <span className="text-lg font-semibold tracking-tight">Teddy</span>
      </Link>

      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {mode === 'signin' ? 'Welcome back' : 'Create your account'}
        </h1>
        <p className="text-sm text-zinc-400">
          {mode === 'signin'
            ? 'Sign in to pick up where you left off.'
            : 'Start capturing class notes in seconds.'}
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-400" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 transition focus:border-amber-400/40 focus:outline-none focus:ring-2 focus:ring-amber-400/10"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-400" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 transition focus:border-amber-400/40 focus:outline-none focus:ring-2 focus:ring-amber-400/10"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-1 rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-medium text-zinc-950 shadow-lg shadow-amber-400/20 transition hover:bg-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-400/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>

        {error && (
          <p className="rounded-lg border border-rose-900/40 bg-rose-950/20 px-3 py-2 text-sm text-rose-300">
            {error}
          </p>
        )}
        {info && (
          <p className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-300">
            {info}
          </p>
        )}
      </form>

      <button
        type="button"
        onClick={() => {
          setMode(mode === 'signin' ? 'signup' : 'signin');
          setError(null);
          setInfo(null);
        }}
        className="self-start text-sm text-zinc-400 underline decoration-zinc-700 underline-offset-4 transition hover:text-zinc-100 hover:decoration-zinc-500"
      >
        {mode === 'signin'
          ? "Don't have an account? Create one"
          : 'Already have an account? Sign in'}
      </button>
    </main>
  );
}
