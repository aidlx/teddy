import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSupabase } from '@/lib/supabase/server';
import { CaptureBox } from '@/components/CaptureBox';
import { formatRelative, isOverdue } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 px-6">
        <h1 className="text-4xl font-semibold tracking-tight">Teddy</h1>
        <p className="text-center text-zinc-400">Your study assistant.</p>
        <Link
          href="/login"
          className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black hover:bg-zinc-200"
        >
          Sign in
        </Link>
      </main>
    );
  }

  const [{ data: courses }, { data: openTasks }, { data: recentNotes }] = await Promise.all([
    supabase.from('courses').select('id, name, code, color'),
    supabase
      .from('tasks')
      .select('id, title, due_at, course_id, completed_at')
      .is('completed_at', null)
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(20),
    supabase
      .from('notes')
      .select('id, title, content, course_id, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const coursesById = new Map((courses ?? []).map((c) => [c.id, c] as const));
  const tasks = openTasks ?? [];
  const notes = recentNotes ?? [];
  const hasCourses = (courses ?? []).length > 0;

  // If no courses yet, nudge onboarding.
  if (!hasCourses) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6">
        <h1 className="text-3xl font-semibold">Welcome to Teddy</h1>
        <p className="text-zinc-400">
          Start by adding the courses you&apos;re taking. Teddy uses them to understand what you capture.
        </p>
        <Link
          href="/courses"
          className="self-start rounded-md bg-white px-4 py-2 text-sm font-medium text-black hover:bg-zinc-200"
        >
          Add courses
        </Link>
      </main>
    );
  }

  const overdue = tasks.filter((t) => isOverdue(t.due_at));
  const dueSoon = tasks.filter((t) => !isOverdue(t.due_at));

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Teddy</h1>
        <nav className="flex gap-4 text-sm text-zinc-400">
          <Link href="/tasks" className="hover:text-zinc-100">
            Tasks
          </Link>
          <Link href="/notes" className="hover:text-zinc-100">
            Notes
          </Link>
          <Link href="/courses" className="hover:text-zinc-100">
            Courses
          </Link>
          <SignOutButton />
        </nav>
      </header>

      <CaptureBox />

      {overdue.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-red-400">Overdue</h2>
          <ul className="flex flex-col gap-1">
            {overdue.map((t) => (
              <TaskItem key={t.id} task={t} course={t.course_id ? coursesById.get(t.course_id) ?? null : null} overdue />
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-400">Open tasks</h2>
        {dueSoon.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing due. Nice.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {dueSoon.slice(0, 10).map((t) => (
              <TaskItem key={t.id} task={t} course={t.course_id ? coursesById.get(t.course_id) ?? null : null} />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-400">Recent notes</h2>
        {notes.length === 0 ? (
          <p className="text-sm text-zinc-500">Capture something above.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {notes.map((n) => (
              <li
                key={n.id}
                className="rounded-md border border-zinc-800 px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  {n.course_id && coursesById.get(n.course_id) && (
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: coursesById.get(n.course_id)?.color ?? '#6366f1' }}
                    />
                  )}
                  <span className="font-medium">{n.title ?? 'Note'}</span>
                  <span className="ml-auto text-xs text-zinc-500">
                    {formatRelative(n.created_at)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-zinc-400">{n.content}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function TaskItem({
  task,
  course,
  overdue = false,
}: {
  task: { id: string; title: string; due_at: string | null };
  course: { name: string; color: string | null } | null;
  overdue?: boolean;
}) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-zinc-800 px-3 py-2 text-sm">
      {course && (
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: course.color ?? '#6366f1' }}
          title={course.name}
        />
      )}
      <span>{task.title}</span>
      {task.due_at && (
        <span className={`ml-auto text-xs ${overdue ? 'text-red-400' : 'text-zinc-500'}`}>
          {formatRelative(task.due_at)}
        </span>
      )}
    </li>
  );
}

async function SignOutButton() {
  async function signOut() {
    'use server';
    const supabase = await getServerSupabase();
    await supabase.auth.signOut();
    redirect('/login');
  }
  return (
    <form action={signOut}>
      <button type="submit" className="hover:text-zinc-100">
        Sign out
      </button>
    </form>
  );
}
