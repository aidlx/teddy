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
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/10 ring-1 ring-amber-400/30 dark:ring-amber-400/20">
            <span className="text-3xl" aria-hidden>
              🧸
            </span>
          </div>
          <h1 className="text-4xl font-semibold tracking-tight">Teddy</h1>
          <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
            Your study assistant. Capture what happens in class — Teddy keeps it organized.
          </p>
        </div>
        <Link
          href="/login"
          className="rounded-lg bg-amber-400 px-5 py-2.5 text-sm font-medium text-zinc-950 shadow-lg shadow-amber-400/30 transition hover:bg-amber-300 dark:shadow-amber-400/20"
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

  if (!hasCourses) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6">
        <h1 className="text-3xl font-semibold tracking-tight">Welcome to Teddy</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Start by adding the courses you&apos;re taking. Teddy uses them to understand what you
          capture.
        </p>
        <Link
          href="/courses"
          className="self-start rounded-lg bg-amber-400 px-5 py-2.5 text-sm font-medium text-zinc-950 shadow-lg shadow-amber-400/30 transition hover:bg-amber-300 dark:shadow-amber-400/20"
        >
          Add courses
        </Link>
      </main>
    );
  }

  const overdue = tasks.filter((t) => isOverdue(t.due_at));
  const dueSoon = tasks.filter((t) => !isOverdue(t.due_at));

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-6 md:gap-8 md:px-6 md:py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/10 ring-1 ring-amber-400/30 dark:ring-amber-400/20">
            <span className="text-base" aria-hidden>
              🧸
            </span>
          </span>
          <span className="text-lg font-semibold tracking-tight">Teddy</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <NavLink href="/tasks">Tasks</NavLink>
          <NavLink href="/notes">Notes</NavLink>
          <NavLink href="/calendar">Calendar</NavLink>
          <NavLink href="/courses">Courses</NavLink>
          <NavLink href="/captures">History</NavLink>
          <SignOutButton />
        </nav>
      </header>

      <CaptureBox />

      {overdue.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeading color="rose">Overdue</SectionHeading>
          <ul className="flex flex-col gap-1.5">
            {overdue.map((t) => (
              <TaskItem
                key={t.id}
                task={t}
                course={t.course_id ? coursesById.get(t.course_id) ?? null : null}
                overdue
              />
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <SectionHeading>Open tasks</SectionHeading>
        {dueSoon.length === 0 ? (
          <EmptyState>Nothing due. Nice.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {dueSoon.slice(0, 10).map((t) => (
              <TaskItem
                key={t.id}
                task={t}
                course={t.course_id ? coursesById.get(t.course_id) ?? null : null}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading>Recent notes</SectionHeading>
        {notes.length === 0 ? (
          <EmptyState>Capture something above.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {notes.map((n) => {
              const course = n.course_id ? coursesById.get(n.course_id) : null;
              return (
                <li
                  key={n.id}
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm transition hover:border-zinc-300 hover:bg-zinc-100/60 dark:border-zinc-900 dark:bg-zinc-950/40 dark:hover:border-zinc-800 dark:hover:bg-zinc-900/40"
                >
                  <div className="flex items-center gap-2">
                    {course && (
                      <span
                        className="h-2 w-2 flex-none rounded-full"
                        style={{ backgroundColor: course.color ?? '#6366f1' }}
                        title={course.name}
                      />
                    )}
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{n.title ?? 'Note'}</span>
                    <span className="ml-auto flex-none text-xs text-zinc-500">
                      {formatRelative(n.created_at)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-zinc-600 dark:text-zinc-400">{n.content}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-2.5 py-1.5 text-zinc-600 transition hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900/60 dark:hover:text-zinc-100"
    >
      {children}
    </Link>
  );
}

function SectionHeading({
  children,
  color = 'zinc',
}: {
  children: React.ReactNode;
  color?: 'zinc' | 'rose';
}) {
  const cls =
    color === 'rose'
      ? 'text-rose-600 dark:text-rose-400'
      : 'text-zinc-500';
  return (
    <h2 className={`text-xs font-semibold uppercase tracking-wider ${cls}`}>{children}</h2>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 bg-white/60 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-900 dark:bg-zinc-950/40">
      {children}
    </div>
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
    <li className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm transition hover:border-zinc-300 hover:bg-zinc-100/60 dark:border-zinc-900 dark:bg-zinc-950/40 dark:hover:border-zinc-800 dark:hover:bg-zinc-900/40">
      {course && (
        <span
          className="h-2 w-2 flex-none rounded-full"
          style={{ backgroundColor: course.color ?? '#6366f1' }}
          title={course.name}
        />
      )}
      <span className="truncate">{task.title}</span>
      {task.due_at && (
        <span
          className={`ml-auto flex-none text-xs ${overdue ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-500'}`}
        >
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
      <button
        type="submit"
        className="rounded-md px-2.5 py-1.5 text-zinc-600 transition hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900/60 dark:hover:text-zinc-100"
      >
        Sign out
      </button>
    </form>
  );
}
