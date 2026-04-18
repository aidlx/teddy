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
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">History</h1>
        <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-200">
          ← Home
        </Link>
      </div>

      <p className="text-xs text-zinc-500">
        Every message you&apos;ve captured. Click one to see exactly how Teddy interpreted it.
      </p>

      <ul className="flex flex-col gap-2">
        {rows.length === 0 && (
          <li className="rounded-md border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500">
            No captures yet.
          </li>
        )}
        {rows.map((c) => {
          const taskCount = c.tasks?.length ?? 0;
          const noteCount = c.notes?.length ?? 0;
          return (
            <li key={c.id} className="rounded-md border border-zinc-800 text-sm">
              <Link
                href={`/captures/${c.id}`}
                className="flex flex-col gap-1 px-4 py-3 hover:bg-zinc-900/40"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">{formatRelative(c.created_at)}</span>
                  <span className="ml-auto text-xs text-zinc-500">
                    {taskCount > 0 && `${taskCount} task${taskCount === 1 ? '' : 's'}`}
                    {taskCount > 0 && noteCount > 0 && ' · '}
                    {noteCount > 0 && `${noteCount} note${noteCount === 1 ? '' : 's'}`}
                    {taskCount === 0 && noteCount === 0 && 'no items'}
                  </span>
                </div>
                <p className="line-clamp-2 text-zinc-300">{c.raw_text}</p>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
