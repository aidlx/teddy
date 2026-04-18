'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { formatRelative, isOverdue } from '@/lib/format';

interface Task {
  id: string;
  title: string;
  description: string | null;
  due_at: string | null;
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
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');
  const [courseFilter, setCourseFilter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const supabase = getBrowserSupabase();
    const [t, c] = await Promise.all([
      supabase
        .from('tasks')
        .select('*')
        .order('due_at', { ascending: true, nullsFirst: false }),
      supabase.from('courses').select('id, name, color'),
    ]);
    if (t.error) setError(t.error.message);
    if (c.error) setError(c.error.message);
    setTasks(t.data ?? []);
    setCourses(c.data ?? []);
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
          className="text-sm text-zinc-400 transition hover:text-zinc-100"
        >
          ← Home
        </Link>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/40 p-0.5">
          {(['open', 'done', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1 text-xs capitalize transition ${
                filter === f
                  ? 'bg-amber-400 text-zinc-950'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <select
          value={courseFilter}
          onChange={(e) => setCourseFilter(e.target.value)}
          className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-700 focus:border-amber-400/40 focus:outline-none focus:ring-2 focus:ring-amber-400/10"
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
        <p className="rounded-lg border border-rose-900/40 bg-rose-950/20 px-3 py-2 text-sm text-rose-300">
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-1.5">
        {filtered.length === 0 && (
          <li className="rounded-xl border border-dashed border-zinc-900 bg-zinc-950/40 px-4 py-8 text-center text-sm text-zinc-500">
            No tasks here yet.
          </li>
        )}
        {filtered.map((t) => {
          const course = t.course_id ? coursesById.get(t.course_id) : null;
          const overdue = !t.completed_at && isOverdue(t.due_at);
          return (
            <li
              key={t.id}
              className="group flex items-center gap-2.5 rounded-xl border border-zinc-900 bg-zinc-950/40 px-4 py-2.5 text-sm transition hover:border-zinc-800 hover:bg-zinc-900/40"
            >
              <input
                type="checkbox"
                checked={!!t.completed_at}
                onChange={() => toggleComplete(t)}
                className="h-4 w-4 flex-none cursor-pointer accent-amber-400"
              />
              {course && (
                <span
                  className="h-2 w-2 flex-none rounded-full"
                  style={{ backgroundColor: course.color ?? '#6366f1' }}
                  title={course.name}
                />
              )}
              <span
                className={`truncate ${t.completed_at ? 'text-zinc-500 line-through' : 'text-zinc-100'}`}
              >
                {t.title}
              </span>
              {t.due_at && (
                <span
                  className={`ml-auto flex-none text-xs ${overdue ? 'text-rose-400' : 'text-zinc-500'}`}
                >
                  {formatRelative(t.due_at)}
                </span>
              )}
              {t.capture_id && (
                <Link
                  href={`/captures/${t.capture_id}`}
                  className={`flex-none text-xs text-zinc-600 transition hover:text-zinc-300 ${t.due_at ? '' : 'ml-auto'}`}
                  title="View source capture"
                >
                  source
                </Link>
              )}
              <button
                onClick={() => deleteTask(t.id)}
                className="flex-none text-lg leading-none text-zinc-700 transition hover:text-rose-400"
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
