'use client';

import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { toLocalWallClock } from '@/lib/assistant/time';
import { formatTaskDue, formatTaskDueExact } from '@/lib/format';

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean | null;
  course_id: string | null;
  source_tz: string | null;
  subscription_id: string | null;
}

interface CourseRow {
  id: string;
  name: string;
  code: string | null;
  color: string | null;
}

interface SubscriptionRow {
  id: string;
  name: string;
}

interface ReminderRow {
  id: string;
  title: string;
  due_at: string | null;
  due_kind: string | null;
  due_tz: string | null;
  anchor_event_id: string | null;
  offset_minutes: number | null;
  completed_at: string | null;
}

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

export function EventDetailModal({
  eventId,
  userTz,
  onClose,
  onOpenTask,
}: {
  eventId: string;
  userTz: string;
  onClose: () => void;
  onOpenTask?: (taskId: string) => void;
}) {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [course, setCourse] = useState<CourseRow | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [reminders, setReminders] = useState<ReminderRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = getBrowserSupabase();
      const eventRes = await supabase
        .from('events')
        .select(
          'id, title, description, location, start_at, end_at, all_day, course_id, source_tz, subscription_id',
        )
        .eq('id', eventId)
        .maybeSingle();

      if (cancelled) return;
      if (eventRes.error) {
        console.error('[EventDetailModal] events query error', eventRes.error);
        setLoadError(`${eventRes.error.message} (${eventRes.error.code ?? 'no code'})`);
        return;
      }
      if (!eventRes.data) {
        console.warn('[EventDetailModal] no event found for id', eventId);
        setLoadError(`Event not found (id: ${eventId}).`);
        return;
      }

      const eventRow = eventRes.data;
      setEvent(eventRow as EventRow);

      const [courseRes, subRes, remindersRes] = await Promise.all([
        eventRow.course_id
          ? supabase
              .from('courses')
              .select('id, name, code, color')
              .eq('id', eventRow.course_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        eventRow.subscription_id
          ? supabase
              .from('calendar_subscriptions')
              .select('id, name')
              .eq('id', eventRow.subscription_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from('tasks')
          .select(
            'id, title, due_at, due_kind, due_tz, anchor_event_id, offset_minutes, completed_at',
          )
          .eq('anchor_event_id', eventRow.id)
          .order('due_at'),
      ]);
      if (cancelled) return;
      setCourse((courseRes.data ?? null) as CourseRow | null);
      setSubscription((subRes.data ?? null) as SubscriptionRow | null);
      setReminders((remindersRes.data ?? []) as ReminderRow[]);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const startLabel = event
    ? event.all_day
      ? new Date(event.start_at).toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          timeZone: userTz,
        })
      : formatFull(event.start_at, userTz)
    : null;
  const endTimeLabel =
    event && event.end_at && !event.all_day ? formatTimeOnly(event.end_at, userTz) : null;
  const duration = event ? formatDuration(event.start_at, event.end_at) : null;

  return (
    <Modal onClose={onClose} ariaLabel="Event details">
      <div className="flex flex-col gap-5 px-5 py-6 md:px-8 md:py-8">
        <header className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight md:text-2xl">Event</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Details for this scheduled event and any reminders linked to it.
          </p>
        </header>

        {loadError && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
            {loadError}
          </p>
        )}

        {!event && !loadError && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
        )}

        {event && (
          <div className="grid gap-6 lg:grid-cols-[1.4fr_minmax(16rem,20rem)]">
            <section className="flex flex-col gap-5 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/60">
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Title
                </span>
                <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {event.title}
                </p>
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
                <h3 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Course
                </h3>
                {course ? (
                  <div className="mt-3 flex items-center gap-2 text-sm">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: course.color ?? '#6366f1' }}
                    />
                    <span className="text-zinc-900 dark:text-zinc-100">{course.name}</span>
                    {course.code && (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        ({course.code})
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                    No linked course.
                  </p>
                )}
              </section>

              {subscription && (
                <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/60">
                  <h3 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    Source
                  </h3>
                  <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                    {subscription.name}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Imported from an iCal subscription — edits happen in the source calendar.
                  </p>
                </section>
              )}

              <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/60">
                <h3 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Reminders
                </h3>
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
                          <button
                            type="button"
                            onClick={() => onOpenTask?.(reminder.id)}
                            className="flex w-full flex-col gap-0.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left transition hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950/40 dark:hover:border-zinc-700"
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
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </aside>
          </div>
        )}
      </div>
    </Modal>
  );
}
