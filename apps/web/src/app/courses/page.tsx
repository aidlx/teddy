'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase/client';

interface Course {
  id: string;
  name: string;
  code: string | null;
  color: string | null;
  schedule_text: string | null;
}

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#6366f1', '#a855f7', '#ec4899'];

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [schedule, setSchedule] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadCourses();
  }, []);

  async function loadCourses() {
    const supabase = getBrowserSupabase();
    const { data, error } = await supabase
      .from('courses')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) setError(error.message);
    else setCourses(data ?? []);
  }

  async function addCourse(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);

    const supabase = getBrowserSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError('Not signed in');
      setLoading(false);
      return;
    }

    const color = COLORS[courses.length % COLORS.length] ?? '#6366f1';
    const { error } = await supabase.from('courses').insert({
      owner_id: user.id,
      name: name.trim(),
      code: code.trim() || null,
      schedule_text: schedule.trim() || null,
      color,
    });
    if (error) {
      setError(error.message);
    } else {
      setName('');
      setCode('');
      setSchedule('');
      await loadCourses();
    }
    setLoading(false);
  }

  async function deleteCourse(id: string) {
    const supabase = getBrowserSupabase();
    const { error } = await supabase.from('courses').delete().eq('id', id);
    if (error) setError(error.message);
    else await loadCourses();
  }

  const inputCls =
    'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 transition focus:border-amber-400/50 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:border-amber-400/40 dark:focus:ring-amber-400/10';

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-6 md:px-6 md:py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Courses</h1>
        <Link
          href="/"
          className="text-sm text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          ← Home
        </Link>
      </header>

      <form
        onSubmit={addCourse}
        className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 md:p-5 dark:border-zinc-800 dark:bg-zinc-950/60"
      >
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Add a course
        </h2>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Course name (e.g. Intro to Algorithms)"
          required
          className={inputCls}
        />
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Code (CS101)"
            className={`flex-1 ${inputCls}`}
          />
          <input
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="Schedule (Mon/Wed 10am)"
            className={`flex-1 ${inputCls}`}
          />
        </div>
        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="mt-1 self-start rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950 shadow-sm shadow-amber-400/30 transition hover:bg-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-400/40 disabled:cursor-not-allowed disabled:opacity-40 dark:shadow-amber-400/20"
        >
          {loading ? 'Adding…' : 'Add course'}
        </button>
        {error && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
            {error}
          </p>
        )}
      </form>

      <ul className="flex flex-col gap-2">
        {courses.length === 0 && (
          <li className="rounded-xl border border-dashed border-zinc-300 bg-white/60 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-900 dark:bg-zinc-950/40">
            No courses yet. Add one above.
          </li>
        )}
        {courses.map((c) => (
          <li
            key={c.id}
            className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 transition hover:border-zinc-300 hover:bg-zinc-100/60 dark:border-zinc-900 dark:bg-zinc-950/40 dark:hover:border-zinc-800 dark:hover:bg-zinc-900/40"
          >
            <span
              className="h-3 w-3 flex-none rounded-full ring-2 ring-white dark:ring-zinc-950"
              style={{ backgroundColor: c.color ?? '#6366f1' }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                <span className="truncate">{c.name}</span>
                {c.code && (
                  <span className="flex-none rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wider text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                    {c.code}
                  </span>
                )}
              </div>
              {c.schedule_text && (
                <div className="truncate text-xs text-zinc-500">{c.schedule_text}</div>
              )}
            </div>
            <button
              onClick={() => deleteCourse(c.id)}
              className="flex-none text-xs text-zinc-500 transition hover:text-rose-600 dark:text-zinc-600 dark:hover:text-rose-400"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
