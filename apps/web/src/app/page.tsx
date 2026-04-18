import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSupabase } from '@/lib/supabase/server';
import { AssistantApp } from '@/components/AssistantApp';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 px-6">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/10 ring-1 ring-amber-400/30 dark:ring-amber-400/20">
            <span className="text-3xl" aria-hidden>
              🧸
            </span>
          </div>
          <h1 className="text-4xl font-semibold tracking-tight">Teddy</h1>
          <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
            Your study assistant. Tell Teddy what happens in class — it organizes the rest.
          </p>
        </div>
        <Link
          href="/login"
          className="rounded-lg bg-amber-400 px-5 py-2.5 text-sm font-medium text-zinc-950 shadow-lg shadow-amber-400/30 transition hover:bg-amber-300 dark:shadow-amber-400/20"
        >
          Sign in
        </Link>
      </main>
    );
  }

  const { data: courses } = await supabase.from('courses').select('id').limit(1);
  if ((courses ?? []).length === 0) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6">
        <h1 className="text-3xl font-semibold tracking-tight">Welcome to Teddy</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Start by importing your university schedule or adding the courses you&apos;re taking.
          Teddy uses them to understand what you say.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/calendar"
            className="rounded-lg bg-amber-400 px-5 py-2.5 text-sm font-medium text-zinc-950 shadow-lg shadow-amber-400/30 transition hover:bg-amber-300 dark:shadow-amber-400/20"
          >
            Import calendar
          </Link>
          <Link
            href="/courses"
            className="rounded-lg border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-800 transition hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-900/60"
          >
            Add courses manually
          </Link>
        </div>
      </main>
    );
  }

  async function signOut() {
    'use server';
    const supabase = await getServerSupabase();
    await supabase.auth.signOut();
    redirect('/login');
  }

  return (
    <>
      <form action={signOut} className="fixed right-16 top-3 z-20">
        <button
          type="submit"
          className="rounded-md px-2.5 py-1.5 text-xs text-zinc-500 transition hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-500 dark:hover:bg-zinc-900/60 dark:hover:text-zinc-100"
        >
          Sign out
        </button>
      </form>
      <AssistantApp />
    </>
  );
}
