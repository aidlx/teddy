import Link from 'next/link';
import { getServerSupabase } from '@/lib/supabase/server';

export default async function HomePage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6">
      <h1 className="text-4xl font-semibold tracking-tight">Teddy</h1>
      <p className="text-center text-zinc-400">
        Monorepo scaffold: Next.js + Expo + Supabase + OpenAI.
      </p>

      {user ? (
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-zinc-300">Signed in as {user.email}</p>
          <div className="flex gap-3">
            <Link
              href="/chat"
              className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black hover:bg-zinc-200"
            >
              Open chat
            </Link>
            <Link
              href="/files"
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium hover:bg-zinc-900"
            >
              Files
            </Link>
          </div>
        </div>
      ) : (
        <Link
          href="/login"
          className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black hover:bg-zinc-200"
        >
          Sign in
        </Link>
      )}
    </main>
  );
}
