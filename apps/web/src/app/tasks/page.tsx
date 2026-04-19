'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { formatTaskDue, formatTaskDueExact, isTaskOverdue } from '@/lib/format';

interface Task {
  id: string;
  title: string;
  description: string | null;
  due_at: string | null;
  due_kind: string | null;
  due_tz: string | null;
  anchor_event_id: string | null;
  offset_minutes: number | null;
  completed_at: string | null;
  course_id: string | null;
  capture_id: string | null;
  created_at: string;
}

interface Course {
  id: string;
  name: string;
  color: string | null;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [userTz, setUserTz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');
  const [courseFilter, setCourseFilter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const supabase = getBrowserSupabase();
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const [t, c, p] = await Promise.all([
      supabase
        .from('tasks')
        .select(
          'id, title, description, due_at, due_kind, due_tz, anchor_event_id, offset_minutes, completed_at, course_id, capture_id, created_at',
        )
        .order('due_at', { ascending: true, nullsFirst: false }),
      supabase.from('courses').select('id, name, color'),
      supabase.from('profiles').select('timezone').maybeSingle(),
    ]);
    if (t.error) setError(t.error.message);
    if (c.error) setError(c.error.message);
    if (p.error) setError(p.error.message);
    setTasks(t.data ?? []);
    setCourses(c.data ?? []);
    setUserTz(p.data?.timezone ?? browserTz);
  }

  async function toggleComplete(task: Task) {
    const supabase = getBrowserSupabase();
    const { error } = await supabase
      .from('tasks')
      .update({ completed_at: task.completed_at ? null : new Date().toISOString() })
      .eq('id', task.id);
    if (error) setError(error.message);
    else await load();
  }

  async function deleteTask(id: string) {
    const supabase = getBrowserSupabase();
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) setError(error.message);
    else await load();
  }

  const coursesById = new Map(courses.map((c) => [c.id, c] as const));
  const filtered = tasks.filter((t) => {
    if (filter === 'open' && t.completed_at) return false;
    if (filter === 'done' && !t.completed_at) return false;
    if (courseFilter && t.course_id !== courseFilter) return false;
    return true;
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-6 md:px-6 md:py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Tasks</h1>
        <Link
          href="/"
          className="text-sm text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          ← Home
        </Link>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-900/40">
          {(['open', 'done', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1 text-xs capitalize transition ${
                filter === f
                  ? 'bg-amber-400 text-zinc-950'
                  : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <select
          value={courseFilter}
          onChange={(e) => setCourseFilter(e.target.value)}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 transition hover:border-zinc-300 focus:border-amber-400/50 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-300 dark:hover:border-zinc-700 dark:focus:border-amber-400/40 dark:focus:ring-amber-400/10"
        >
          <option value="">All courses</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-1.5">
        {filtered.length === 0 && (
          <li className="rounded-xl border border-dashed border-zinc-300 bg-white/60 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-900 dark:bg-zinc-950/40">
            No tasks here yet.
          </li>
        )}
        {filtered.map((t) => {
          const course = t.course_id ? coursesById.get(t.course_id) : null;
          const overdue = !t.completed_at && isTaskOverdue(t, userTz);
          return (
            <li
              key={t.id}
              className="group flex gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm transition hover:border-zinc-300 hover:bg-zinc-100/60 dark:border-zinc-900 dark:bg-zinc-950/40 dark:hover:border-zinc-800 dark:hover:bg-zinc-900/40"
            >
              <input
                type="checkbox"
                checked={!!t.completed_at}
                onChange={() => toggleComplete(t)}
                className="mt-1 h-4 w-4 flex-none cursor-pointer accent-amber-400"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {course && (
                    <span
                      className="h-2 w-2 flex-none rounded-full"
                      style={{ backgroundColor: course.color ?? '#6366f1' }}
                      title={course.name}
                    />
                  )}
                  <Link
                    href={`/tasks/${t.id}`}
                    className={`min-w-0 truncate font-medium transition hover:text-amber-700 dark:hover:text-amber-300 ${
                      t.completed_at
                        ? 'text-zinc-400 line-through dark:text-zinc-500'
                        : 'text-zinc-900 dark:text-zinc-100'
                    }`}
                  >
                    {t.title}
                  </Link>
                  {course && (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                      {course.name}
                    </span>
                  )}
                  {t.due_at && (
                    <span
                      title={formatTaskDueExact(t, userTz)}
                      className={`ml-auto flex-none text-xs ${overdue ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-500'}`}
                    >
                      {formatTaskDue(t, userTz)}
                    </span>
                  )}
                </div>
                {(t.description || t.capture_id || t.due_at) && (
                  <div className="mt-1.5 flex flex-col gap-1">
                    {t.description && (
                      <p className="line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
                        {t.description}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-500">
                      {t.due_at && (
                        <span title={formatTaskDueExact(t, userTz)}>
                          {formatTaskDueExact(t, userTz)}
                        </span>
                      )}
                      <Link
                        href={`/tasks/${t.id}`}
                        className="underline decoration-zinc-300 underline-offset-4 transition hover:text-zinc-900 hover:decoration-zinc-500 dark:decoration-zinc-700 dark:hover:text-zinc-200"
                      >
                        Open details
                      </Link>
                      {t.capture_id && (
                        <Link
                          href={`/captures/${t.capture_id}`}
                          className="underline decoration-zinc-300 underline-offset-4 transition hover:text-zinc-900 hover:decoration-zinc-500 dark:decoration-zinc-700 dark:hover:text-zinc-200"
                        >
                          Source capture
                        </Link>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={() => deleteTask(t.id)}
                className="flex-none self-start text-lg leading-none text-zinc-400 transition hover:text-rose-600 dark:text-zinc-700 dark:hover:text-rose-400"
                aria-label="Delete task"
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
