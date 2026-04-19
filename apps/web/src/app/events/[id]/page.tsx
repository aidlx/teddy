import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerSupabase } from '@/lib/supabase/server';
import { resolveUserTz, toLocalWallClock } from '@/lib/assistant/time';
import { formatTaskDue, formatTaskDueExact } from '@/lib/format';

export const dynamic = 'force-dynamic';

function formatFull(iso: string, tz: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  });
}

function formatTimeOnly(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  });
}

function formatDuration(startIso: string, endIso: string | null): string | null {
  if (!endIso) return null;
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

export default async function EventDetailPage({
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

  const { data: event } = await supabase
    .from('events')
    .select(
      'id, title, description, location, start_at, end_at, all_day, course_id, source_tz, subscription_id, ical_uid',
    )
    .eq('id', id)
    .maybeSingle();

  if (!event) notFound();

  const [courseRes, remindersRes, subscriptionRes, userTz] = await Promise.all([
    event.course_id
      ? supabase
          .from('courses')
          .select('id, name, code, color')
          .eq('id', event.course_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('tasks')
      .select('id, title, due_at, due_kind, due_tz, anchor_event_id, offset_minutes, completed_at')
      .eq('anchor_event_id', event.id)
      .order('due_at'),
    event.subscription_id
      ? supabase
          .from('calendar_subscriptions')
          .select('id, name')
          .eq('id', event.subscription_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    resolveUserTz(supabase, user.id),
  ]);

  const course = courseRes.data;
  const reminders = remindersRes.data ?? [];
  const subscription = subscriptionRes.data;

  const startLabel = event.all_day
    ? new Date(event.start_at).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: userTz,
      })
    : formatFull(event.start_at, userTz);
  const endTimeLabel = event.end_at && !event.all_day ? formatTimeOnly(event.end_at, userTz) : null;
  const duration = formatDuration(event.start_at, event.end_at);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-6 md:px-6 md:py-10">
      <header className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Event</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Details for this scheduled event and any reminders linked to it.
          </p>
        </div>
        <Link
          href="/calendar"
          className="text-sm text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          ← Calendar
        </Link>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_minmax(16rem,20rem)]">
        <section className="flex flex-col gap-5 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/60">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Title
            </span>
            <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{event.title}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Starts
              </span>
              <span className="text-sm text-zinc-900 dark:text-zinc-100">{startLabel}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Ends
              </span>
              <span className="text-sm text-zinc-900 dark:text-zinc-100">
                {endTimeLabel ?? (event.all_day ? 'All day' : '—')}
              </span>
            </div>
          </div>

          {duration && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Duration
              </span>
              <span className="text-sm text-zinc-900 dark:text-zinc-100">{duration}</span>
            </div>
          )}

          {event.location && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Location
              </span>
              <span className="text-sm text-zinc-900 dark:text-zinc-100">{event.location}</span>
            </div>
          )}

          {event.description && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Description
              </span>
              <p className="whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">
                {event.description}
              </p>
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/60">
            <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Course
            </h2>
            {course ? (
              <div className="mt-3 flex items-center gap-2 text-sm">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: course.color ?? '#6366f1' }}
                />
                <span className="text-zinc-900 dark:text-zinc-100">{course.name}</span>
                {course.code && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">({course.code})</span>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">No linked course.</p>
            )}
          </section>

          {subscription && (
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/60">
              <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                Source
              </h2>
              <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{subscription.name}</p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Imported from an iCal subscription — edits happen in the source calendar.
              </p>
            </section>
          )}

          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/60">
            <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Reminders
            </h2>
            {reminders.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                No reminders linked to this event.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2 text-sm">
                {reminders.map((reminder) => {
                  const task = {
                    due_at: reminder.due_at,
                    due_kind: reminder.due_kind,
                    due_tz: reminder.due_tz,
                  };
                  const summary = formatTaskDue(task, userTz);
                  const exact = formatTaskDueExact(task, userTz);
                  return (
                    <li key={reminder.id}>
                      <Link
                        href={`/tasks/${reminder.id}`}
                        className="flex flex-col gap-0.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 transition hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950/40 dark:hover:border-zinc-700"
                      >
                        <span
                          className={`text-zinc-900 dark:text-zinc-100 ${
                            reminder.completed_at ? 'line-through opacity-60' : ''
                          }`}
                        >
                          {reminder.title}
                        </span>
                        <span
                          className="text-xs text-zinc-500 dark:text-zinc-400"
                          title={exact || undefined}
                        >
                          {summary ||
                            (reminder.due_at
                              ? toLocalWallClock(reminder.due_at, userTz)
                              : 'No due time')}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
