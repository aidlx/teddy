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
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-200">
          ← Home
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['open', 'done', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-md px-3 py-1 text-xs ${
              filter === f ? 'bg-white text-black' : 'border border-zinc-700 text-zinc-300'
            }`}
          >
            {f}
          </button>
        ))}
        <select
          value={courseFilter}
          onChange={(e) => setCourseFilter(e.target.value)}
          className="rounded-md border border-zinc-700 bg-transparent px-2 py-1 text-xs"
        >
          <option value="">All courses</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <ul className="flex flex-col gap-1">
        {filtered.length === 0 && (
          <li className="rounded-md border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500">
            No tasks.
          </li>
        )}
        {filtered.map((t) => {
          const course = t.course_id ? coursesById.get(t.course_id) : null;
          const overdue = !t.completed_at && isOverdue(t.due_at);
          return (
            <li
              key={t.id}
              className="flex items-center gap-2 rounded-md border border-zinc-800 px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                checked={!!t.completed_at}
                onChange={() => toggleComplete(t)}
                className="h-4 w-4 cursor-pointer"
              />
              {course && (
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: course.color ?? '#6366f1' }}
                  title={course.name}
                />
              )}
              <span className={t.completed_at ? 'text-zinc-500 line-through' : ''}>
                {t.title}
              </span>
              {t.due_at && (
                <span className={`ml-auto text-xs ${overdue ? 'text-red-400' : 'text-zinc-500'}`}>
                  {formatRelative(t.due_at)}
                </span>
              )}
              <button
                onClick={() => deleteTask(t.id)}
                className="text-xs text-zinc-600 hover:text-red-400"
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
