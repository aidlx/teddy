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
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Notes</h1>
        <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-200">
          ← Home
        </Link>
      </div>

      <select
        value={courseFilter}
        onChange={(e) => setCourseFilter(e.target.value)}
        className="self-start rounded-md border border-zinc-700 bg-transparent px-2 py-1 text-xs"
      >
        <option value="">All courses</option>
        {courses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <ul className="flex flex-col gap-2">
        {filtered.length === 0 && (
          <li className="rounded-md border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500">
            No notes.
          </li>
        )}
        {filtered.map((n) => {
          const course = n.course_id ? coursesById.get(n.course_id) : null;
          return (
            <li key={n.id} className="rounded-md border border-zinc-800 px-4 py-3 text-sm">
              <div className="flex items-center gap-2">
                {course && (
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: course.color ?? '#6366f1' }}
                    title={course.name}
                  />
                )}
                <span className="font-medium">{n.title ?? 'Note'}</span>
                <span className="ml-auto text-xs text-zinc-500">
                  {formatRelative(n.created_at)}
                </span>
                {n.capture_id && (
                  <Link
                    href={`/captures/${n.capture_id}`}
                    className="text-xs text-zinc-600 hover:text-zinc-300"
                    title="View source capture"
                  >
                    source
                  </Link>
                )}
                <button
                  onClick={() => deleteNote(n.id)}
                  className="text-xs text-zinc-600 hover:text-red-400"
                >
                  ×
                </button>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-zinc-300">{n.content}</p>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
