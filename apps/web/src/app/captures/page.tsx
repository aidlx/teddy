import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSupabase } from '@/lib/supabase/server';
import { formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function CapturesPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: captures } = await supabase
    .from('captures')
    .select('id, raw_text, created_at, tasks(id), notes(id)')
    .order('created_at', { ascending: false })
    .limit(100);

  const rows = captures ?? [];

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-6 md:px-6 md:py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">History</h1>
        <Link
          href="/"
          className="text-sm text-zinc-400 transition hover:text-zinc-100"
        >
          ← Home
        </Link>
      </header>

      <p className="text-sm text-zinc-500">
        Every message you&apos;ve captured. Click one to see exactly how Teddy interpreted it.
      </p>

      <ul className="flex flex-col gap-2">
        {rows.length === 0 && (
          <li className="rounded-xl border border-dashed border-zinc-900 bg-zinc-950/40 px-4 py-8 text-center text-sm text-zinc-500">
            No captures yet.
          </li>
        )}
        {rows.map((c) => {
          const taskCount = c.tasks?.length ?? 0;
          const noteCount = c.notes?.length ?? 0;
          return (
            <li key={c.id}>
              <Link
                href={`/captures/${c.id}`}
                className="flex flex-col gap-1.5 rounded-xl border border-zinc-900 bg-zinc-950/40 px-4 py-3 text-sm transition hover:border-zinc-800 hover:bg-zinc-900/40"
              >
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-500">{formatRelative(c.created_at)}</span>
                  <span className="ml-auto flex items-center gap-1.5">
                    {taskCount > 0 && (
                      <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
                        {taskCount} {taskCount === 1 ? 'task' : 'tasks'}
                      </span>
                    )}
                    {noteCount > 0 && (
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-300">
                        {noteCount} {noteCount === 1 ? 'note' : 'notes'}
                      </span>
                    )}
                    {taskCount === 0 && noteCount === 0 && (
                      <span className="text-zinc-600">no items</span>
                    )}
                  </span>
                </div>
                <p className="line-clamp-2 text-zinc-200">{c.raw_text}</p>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
