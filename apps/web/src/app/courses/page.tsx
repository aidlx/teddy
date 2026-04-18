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

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Courses</h1>
        <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-200">
          ← Home
        </Link>
      </div>

      <form onSubmit={addCourse} className="flex flex-col gap-2 rounded-md border border-zinc-800 p-4">
        <h2 className="text-sm font-medium text-zinc-400">Add a course</h2>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Course name (e.g. Intro to Algorithms)"
          required
          className="rounded-md border border-zinc-700 bg-transparent px-3 py-2 text-sm"
        />
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Code (CS101)"
            className="flex-1 rounded-md border border-zinc-700 bg-transparent px-3 py-2 text-sm"
          />
          <input
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="Schedule (Mon/Wed 10am)"
            className="flex-1 rounded-md border border-zinc-700 bg-transparent px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="mt-1 self-start rounded-md bg-white px-4 py-2 text-sm font-medium text-black hover:bg-zinc-200 disabled:opacity-50"
        >
          {loading ? 'Adding…' : 'Add course'}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>

      <ul className="flex flex-col gap-2">
        {courses.length === 0 && (
          <li className="rounded-md border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500">
            No courses yet. Add one above.
          </li>
        )}
        {courses.map((c) => (
          <li
            key={c.id}
            className="flex items-center gap-3 rounded-md border border-zinc-800 px-4 py-3"
          >
            <span
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: c.color ?? '#6366f1' }}
            />
            <div className="flex-1">
              <div className="text-sm font-medium">
                {c.name}
                {c.code && <span className="ml-2 text-xs text-zinc-500">{c.code}</span>}
              </div>
              {c.schedule_text && <div className="text-xs text-zinc-500">{c.schedule_text}</div>}
            </div>
            <button
              onClick={() => deleteCourse(c.id)}
              className="text-xs text-zinc-500 hover:text-red-400"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
