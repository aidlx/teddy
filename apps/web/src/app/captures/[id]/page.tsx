import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerSupabase } from '@/lib/supabase/server';
import { formatRelative, formatTaskDue, formatTaskDueExact } from '@/lib/format';
import { resolveUserTz } from '@/lib/assistant/time';

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
      supabase
        .from('tasks')
        .select(
          'id, title, due_at, due_kind, due_tz, anchor_event_id, offset_minutes, course_id',
        )
        .eq('capture_id', id),
      supabase.from('notes').select('*').eq('capture_id', id),
      supabase.from('courses').select('id, name, color'),
    ]);

  if (!capture) notFound();

  const userTz = await resolveUserTz(supabase, user.id);
  const coursesById = new Map((courses ?? []).map((c) => [c.id, c] as const));
  const parsedPretty = capture.parsed_json
    ? JSON.stringify(capture.parsed_json, null, 2)
    : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-6 md:px-6 md:py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Capture</h1>
        <Link
          href="/captures"
          className="text-sm text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          ← History
        </Link>
      </header>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          <span>You wrote</span>
          <span className="text-zinc-300 dark:text-zinc-700">·</span>
          <span className="font-normal normal-case tracking-normal text-zinc-500">
            {formatRelative(capture.created_at)}
          </span>
        </div>
        <blockquote className="whitespace-pre-wrap rounded-2xl border border-zinc-200 bg-white px-4 py-4 text-[15px] leading-relaxed text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-100">
          {capture.raw_text}
        </blockquote>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Created from this capture
        </h2>
        {(tasks ?? []).length === 0 && (notes ?? []).length === 0 && (
          <p className="rounded-xl border border-dashed border-zinc-300 bg-white/60 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-900 dark:bg-zinc-950/40">
            Nothing was saved from this capture.
          </p>
        )}
        <ul className="flex flex-col gap-1.5">
          {(tasks ?? []).map((t) => {
            const course = t.course_id ? coursesById.get(t.course_id) : null;
            return (
              <li
                key={t.id}
                className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm dark:border-zinc-900 dark:bg-zinc-950/40"
              >
                <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">
                  task
                </span>
                {course && (
                  <span
                    className="h-2 w-2 flex-none rounded-full"
                    style={{ backgroundColor: course.color ?? '#6366f1' }}
                    title={course.name}
                  />
                )}
                <span className="truncate text-zinc-900 dark:text-zinc-100">{t.title}</span>
                {t.due_at && (
                  <span className="ml-auto flex-none text-xs text-zinc-500" title={formatTaskDueExact(t, userTz)}>
                    {formatTaskDue(t, userTz)}
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
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm dark:border-zinc-900 dark:bg-zinc-950/40"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    note
                  </span>
                  {course && (
                    <span
                      className="h-2 w-2 flex-none rounded-full"
                      style={{ backgroundColor: course.color ?? '#6366f1' }}
                      title={course.name}
                    />
                  )}
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{n.title ?? 'Note'}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{n.content}</p>
              </li>
            );
          })}
        </ul>
      </section>

      {parsedPretty && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            How Teddy interpreted it
          </h2>
          <pre className="overflow-x-auto rounded-xl border border-zinc-200 bg-zinc-100 px-4 py-3 font-mono text-xs leading-relaxed text-zinc-700 dark:border-zinc-900 dark:bg-zinc-950/60 dark:text-zinc-400">
            {parsedPretty}
          </pre>
        </section>
      )}
    </main>
  );
}
