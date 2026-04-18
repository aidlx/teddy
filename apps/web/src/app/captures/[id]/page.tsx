import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerSupabase } from '@/lib/supabase/server';
import { formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function CaptureDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: capture }, { data: tasks }, { data: notes }, { data: courses }] =
    await Promise.all([
      supabase.from('captures').select('*').eq('id', id).maybeSingle(),
      supabase.from('tasks').select('*').eq('capture_id', id),
      supabase.from('notes').select('*').eq('capture_id', id),
      supabase.from('courses').select('id, name, color'),
    ]);

  if (!capture) notFound();

  const coursesById = new Map((courses ?? []).map((c) => [c.id, c] as const));
  const parsedPretty = capture.parsed_json
    ? JSON.stringify(capture.parsed_json, null, 2)
    : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Capture</h1>
        <Link href="/captures" className="text-sm text-zinc-400 hover:text-zinc-200">
          ← History
        </Link>
      </div>

      <section className="flex flex-col gap-2">
        <div className="text-xs text-zinc-500">
          You wrote · {formatRelative(capture.created_at)}
        </div>
        <blockquote className="whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-200">
          {capture.raw_text}
        </blockquote>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-400">Created from this capture</h2>
        {(tasks ?? []).length === 0 && (notes ?? []).length === 0 && (
          <p className="text-sm text-zinc-500">Nothing was saved from this capture.</p>
        )}
        <ul className="flex flex-col gap-1">
          {(tasks ?? []).map((t) => {
            const course = t.course_id ? coursesById.get(t.course_id) : null;
            return (
              <li
                key={t.id}
                className="flex items-center gap-2 rounded-md border border-zinc-800 px-3 py-2 text-sm"
              >
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase text-zinc-300">
                  task
                </span>
                {course && (
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: course.color ?? '#6366f1' }}
                    title={course.name}
                  />
                )}
                <span>{t.title}</span>
                {t.due_at && (
                  <span className="ml-auto text-xs text-zinc-500">
                    {formatRelative(t.due_at)}
                  </span>
                )}
              </li>
            );
          })}
          {(notes ?? []).map((n) => {
            const course = n.course_id ? coursesById.get(n.course_id) : null;
            return (
              <li
                key={n.id}
                className="rounded-md border border-zinc-800 px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase text-zinc-300">
                    note
                  </span>
                  {course && (
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: course.color ?? '#6366f1' }}
                      title={course.name}
                    />
                  )}
                  <span className="font-medium">{n.title ?? 'Note'}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-zinc-300">{n.content}</p>
              </li>
            );
          })}
        </ul>
      </section>

      {parsedPretty && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-zinc-400">How Teddy interpreted it</h2>
          <pre className="overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300">
            {parsedPretty}
          </pre>
        </section>
      )}
    </main>
  );
}
