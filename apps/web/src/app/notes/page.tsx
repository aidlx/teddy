'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { formatRelative } from '@/lib/format';

interface Note {
  id: string;
  title: string | null;
  content: string;
  course_id: string | null;
  capture_id: string | null;
  created_at: string;
}

interface Course {
  id: string;
  name: string;
  color: string | null;
}

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseFilter, setCourseFilter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const supabase = getBrowserSupabase();
    const [n, c] = await Promise.all([
      supabase.from('notes').select('*').order('created_at', { ascending: false }),
      supabase.from('courses').select('id, name, color'),
    ]);
    if (n.error) setError(n.error.message);
    if (c.error) setError(c.error.message);
    setNotes(n.data ?? []);
    setCourses(c.data ?? []);
  }

  async function deleteNote(id: string) {
    const supabase = getBrowserSupabase();
    const { error } = await supabase.from('notes').delete().eq('id', id);
    if (error) setError(error.message);
    else await load();
  }

  const coursesById = new Map(courses.map((c) => [c.id, c] as const));
  const filtered = courseFilter ? notes.filter((n) => n.course_id === courseFilter) : notes;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-6 md:px-6 md:py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Notes</h1>
        <Link
          href="/"
          className="text-sm text-zinc-400 transition hover:text-zinc-100"
        >
          ← Home
        </Link>
      </header>

      <select
        value={courseFilter}
        onChange={(e) => setCourseFilter(e.target.value)}
        className="self-start rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-700 focus:border-amber-400/40 focus:outline-none focus:ring-2 focus:ring-amber-400/10"
      >
        <option value="">All courses</option>
        {courses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {error && (
        <p className="rounded-lg border border-rose-900/40 bg-rose-950/20 px-3 py-2 text-sm text-rose-300">
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {filtered.length === 0 && (
          <li className="rounded-xl border border-dashed border-zinc-900 bg-zinc-950/40 px-4 py-8 text-center text-sm text-zinc-500">
            No notes yet.
          </li>
        )}
        {filtered.map((n) => {
          const course = n.course_id ? coursesById.get(n.course_id) : null;
          return (
            <li
              key={n.id}
              className="rounded-xl border border-zinc-900 bg-zinc-950/40 px-4 py-3 text-sm transition hover:border-zinc-800 hover:bg-zinc-900/40"
            >
              <div className="flex items-center gap-2">
                {course && (
                  <span
                    className="h-2 w-2 flex-none rounded-full"
                    style={{ backgroundColor: course.color ?? '#6366f1' }}
                    title={course.name}
                  />
                )}
                <span className="font-medium text-zinc-100">{n.title ?? 'Note'}</span>
                <span className="ml-auto flex-none text-xs text-zinc-500">
                  {formatRelative(n.created_at)}
                </span>
                {n.capture_id && (
                  <Link
                    href={`/captures/${n.capture_id}`}
                    className="flex-none text-xs text-zinc-600 transition hover:text-zinc-300"
                    title="View source capture"
                  >
                    source
                  </Link>
                )}
                <button
                  onClick={() => deleteNote(n.id)}
                  className="flex-none text-lg leading-none text-zinc-700 transition hover:text-rose-400"
                  aria-label="Delete note"
                >
                  ×
                </button>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-zinc-300">{n.content}</p>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
