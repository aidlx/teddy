import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerSupabase } from '@/lib/supabase/server';
import { resolveUserTz } from '@/lib/assistant/time';
import { TaskDetailClient, type TaskAnchorEvent, type TaskCourse, type TaskRecord } from './task-detail-client';

export const dynamic = 'force-dynamic';

export default async function TaskDetailPage({
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

  const { data: task } = await supabase
    .from('tasks')
    .select(
      'id, title, description, due_at, due_kind, due_tz, anchor_event_id, offset_minutes, completed_at, course_id, capture_id, created_at',
    )
    .eq('id', id)
    .maybeSingle();

  if (!task) notFound();

  const [{ data: courses }, anchorEvent, userTz] = await Promise.all([
    supabase.from('courses').select('id, name, color').order('created_at'),
    task.anchor_event_id
      ? supabase
          .from('events')
          .select('id, title, location, start_at, end_at, source_tz, course_id')
          .eq('id', task.anchor_event_id)
          .maybeSingle()
          .then((res) => res.data ?? null)
      : Promise.resolve(null),
    resolveUserTz(supabase, user.id),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-6 md:px-6 md:py-10">
      <header className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Task</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            View the full task, update its details, or change when it is due.
          </p>
        </div>
        <Link
          href="/tasks"
          className="text-sm text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          ← Tasks
        </Link>
      </header>

      <TaskDetailClient
        initialTask={task as TaskRecord}
        courses={(courses ?? []) as TaskCourse[]}
        anchorEvent={anchorEvent as TaskAnchorEvent | null}
        userTz={userTz}
      />
    </main>
  );
}

