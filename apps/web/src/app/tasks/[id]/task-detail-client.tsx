'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Database } from '@teddy/supabase';
import { formatTaskDue, formatTaskDueExact } from '@/lib/format';
import { resolveTime, toLocalDate, toLocalWallClock } from '@/lib/assistant/time';
import { getBrowserSupabase } from '@/lib/supabase/client';

type TaskUpdate = Database['public']['Tables']['tasks']['Update'];

export interface TaskRecord {
  id: string;
  title: string;
  description: string | null;
  due_at: string | null;
  due_kind: string | null;
  due_tz: string | null;
  anchor_event_id: string | null;
  offset_minutes: number | null;
  completed_at: string | null;
  course_id: string | null;
  capture_id: string | null;
  created_at: string;
}

export interface TaskCourse {
  id: string;
  name: string;
  color: string | null;
}

export interface TaskAnchorEvent {
  id: string;
  title: string;
  location: string | null;
  start_at: string;
  end_at: string | null;
  source_tz: string | null;
  course_id: string | null;
}

type DueMode = 'none' | 'date' | 'datetime' | 'event';

function taskDueMode(task: TaskRecord): DueMode {
  if (task.due_kind === 'event' && task.anchor_event_id) return 'event';
  if (task.due_kind === 'date') return 'date';
  if (task.due_at) return 'datetime';
  return 'none';
}

function dueDateValue(task: TaskRecord, userTz: string): string {
  if (!task.due_at) return '';
  return toLocalDate(task.due_at, task.due_tz ?? userTz);
}

function dueDateTimeValue(task: TaskRecord, userTz: string): string {
  if (!task.due_at) return '';
  return toLocalWallClock(task.due_at, userTz);
}

function formatOffset(minutes: number): string {
  if (minutes === 0) return 'At class start';
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  const parts = [
    hours > 0 ? `${hours}h` : null,
    mins > 0 ? `${mins}m` : null,
  ].filter(Boolean);
  const label = parts.join(' ') || '0m';
  return minutes < 0 ? `${label} before start` : `${label} after start`;
}

export function TaskDetailClient({
  initialTask,
  courses,
  anchorEvent,
  userTz,
  onSaved,
  onDeleted,
}: {
  initialTask: TaskRecord;
  courses: TaskCourse[];
  anchorEvent: TaskAnchorEvent | null;
  userTz: string;
  onSaved?: (task: TaskRecord) => void;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [task, setTask] = useState(initialTask);
  const [title, setTitle] = useState(initialTask.title);
  const [description, setDescription] = useState(initialTask.description ?? '');
  const [courseId, setCourseId] = useState(initialTask.course_id ?? '');
  const [completed, setCompleted] = useState(Boolean(initialTask.completed_at));
  const [dueMode, setDueMode] = useState<DueMode>(() => taskDueMode(initialTask));
  const [dateValue, setDateValue] = useState(() => dueDateValue(initialTask, userTz));
  const [dateTimeValue, setDateTimeValue] = useState(() => dueDateTimeValue(initialTask, userTz));
  const [offsetMinutes, setOffsetMinutes] = useState(initialTask.offset_minutes ?? 0);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const linkedEvent = task.anchor_event_id && anchorEvent?.id === task.anchor_event_id
    ? anchorEvent
    : null;
  const course = task.course_id ? courses.find((entry) => entry.id === task.course_id) ?? null : null;
  const canChooseCourse = dueMode !== 'event' || !anchorEvent?.course_id;
  const eventDisplayTime = anchorEvent
    ? new Date(anchorEvent.start_at).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: userTz,
      })
    : null;
  const summaryDue = task.due_at ? formatTaskDue(task, userTz) : 'No due date';
  const exactDue = task.due_at ? formatTaskDueExact(task, userTz) : null;
  const createdAt = useMemo(
    () =>
      new Date(task.created_at).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: userTz,
      }),
    [task.created_at, userTz],
  );

  function syncForm(nextTask: TaskRecord) {
    setTask(nextTask);
    setTitle(nextTask.title);
    setDescription(nextTask.description ?? '');
    setCourseId(nextTask.course_id ?? '');
    setCompleted(Boolean(nextTask.completed_at));
    setDueMode(taskDueMode(nextTask));
    setDateValue(dueDateValue(nextTask, userTz));
    setDateTimeValue(dueDateTimeValue(nextTask, userTz));
    setOffsetMinutes(nextTask.offset_minutes ?? 0);
  }

  async function saveTask(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }

    const patch: TaskUpdate = {
      title: title.trim(),
      description: description.trim() ? description.trim() : null,
      completed_at: completed
        ? task.completed_at ?? new Date().toISOString()
        : null,
      course_id: canChooseCourse ? (courseId || null) : (anchorEvent?.course_id ?? task.course_id ?? null),
    };

    try {
      if (dueMode === 'none') {
        Object.assign(patch, {
          due_at: null,
          due_kind: 'none',
          due_tz: null,
          anchor_event_id: null,
          offset_minutes: 0,
        });
      } else if (dueMode === 'date') {
        if (!dateValue) {
          setError('Pick a due date.');
          return;
        }
        Object.assign(patch, {
          due_at: resolveTime(dateValue, userTz),
          due_kind: 'date',
          due_tz: userTz,
          anchor_event_id: null,
          offset_minutes: 0,
        });
      } else if (dueMode === 'datetime') {
        if (!dateTimeValue) {
          setError('Pick a due date and time.');
          return;
        }
        Object.assign(patch, {
          due_at: resolveTime(dateTimeValue, userTz),
          due_kind: 'datetime',
          due_tz: userTz,
          anchor_event_id: null,
          offset_minutes: 0,
        });
      } else {
        if (!anchorEvent) {
          setError('This reminder is not linked to a class anymore. Switch it to a date or date-time due instead.');
          return;
        }
        const dueAt = new Date(new Date(anchorEvent.start_at).getTime() + offsetMinutes * 60_000).toISOString();
        Object.assign(patch, {
          due_at: dueAt,
          due_kind: 'event',
          due_tz: anchorEvent.source_tz ?? userTz,
          anchor_event_id: anchorEvent.id,
          offset_minutes: offsetMinutes,
          course_id: anchorEvent.course_id ?? patch.course_id ?? null,
        });
      }
    } catch (err) {
      setError((err as Error).message ?? 'Could not interpret the due time.');
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    const supabase = getBrowserSupabase();
    const { data, error: saveError } = await supabase
      .from('tasks')
      .update(patch)
      .eq('id', task.id)
      .select(
        'id, title, description, due_at, due_kind, due_tz, anchor_event_id, offset_minutes, completed_at, course_id, capture_id, created_at',
      )
      .single();
    setSaving(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    const nextTask = data as TaskRecord;
    syncForm(nextTask);
    setNotice('Saved.');
    onSaved?.(nextTask);
    router.refresh();
  }

  async function deleteTask() {
    const confirmed = window.confirm('Delete this task?');
    if (!confirmed) return;
    setDeleting(true);
    setError(null);
    const supabase = getBrowserSupabase();
    const { error: deleteError } = await supabase.from('tasks').delete().eq('id', task.id);
    setDeleting(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    if (onDeleted) {
      onDeleted();
      router.refresh();
      return;
    }
    router.push('/tasks');
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_minmax(16rem,20rem)]">
      <form
        onSubmit={saveTask}
        className="flex flex-col gap-5 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/60"
      >
        <section className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Title
          </label>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 transition focus:border-amber-400/50 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-100"
          />
        </section>

        <section className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Description
          </label>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={6}
            placeholder="Add more context, steps, or notes for this task."
            className="rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 transition focus:border-amber-400/50 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-100"
          />
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          <section className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Course
            </label>
            <select
              value={canChooseCourse ? courseId : (anchorEvent?.course_id ?? courseId)}
              onChange={(event) => setCourseId(event.target.value)}
              disabled={!canChooseCourse}
              className="rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 transition focus:border-amber-400/50 focus:outline-none focus:ring-2 focus:ring-amber-400/20 disabled:cursor-not-allowed disabled:opacity-70 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-100"
            >
              <option value="">No course</option>
              {courses.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            {!canChooseCourse && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Event-linked reminders inherit their course from the linked class.
              </p>
            )}
          </section>

          <label className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200">
            <input
              type="checkbox"
              checked={completed}
              onChange={(event) => setCompleted(event.target.checked)}
              className="h-4 w-4 accent-amber-400"
            />
            Mark as completed
          </label>
        </div>

        <section className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/30">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Due Settings
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Choose whether this task is just a note, a date-only deadline, a fixed date and time, or a reminder linked to a class.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            {(['none', 'date', 'datetime', 'event'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setDueMode(mode)}
                disabled={mode === 'event' && !anchorEvent}
                className={`rounded-xl border px-3 py-2 text-sm transition ${
                  dueMode === mode
                    ? 'border-amber-400 bg-amber-400/15 text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200'
                    : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-300 dark:hover:border-zinc-700'
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {mode === 'none' ? 'No due date' : mode === 'date' ? 'Date only' : mode === 'datetime' ? 'Date & time' : 'Linked class'}
              </button>
            ))}
          </div>

          {dueMode === 'date' && (
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Due date
              </span>
              <input
                type="date"
                value={dateValue}
                onChange={(event) => setDateValue(event.target.value)}
                className="rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 transition focus:border-amber-400/50 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-100"
              />
            </label>
          )}

          {dueMode === 'datetime' && (
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Due date and time
              </span>
              <input
                type="datetime-local"
                value={dateTimeValue}
                onChange={(event) => setDateTimeValue(event.target.value)}
                className="rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 transition focus:border-amber-400/50 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-100"
              />
            </label>
          )}

          {dueMode === 'event' && anchorEvent && (
            <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950/60">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Linked class
                </span>
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {anchorEvent.title}
                </span>
                {eventDisplayTime && (
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    {eventDisplayTime}
                  </span>
                )}
                {anchorEvent.location && (
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">
                    {anchorEvent.location}
                  </span>
                )}
              </div>

              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Reminder offset
                </span>
                <input
                  type="number"
                  value={offsetMinutes}
                  onChange={(event) => setOffsetMinutes(Number(event.target.value) || 0)}
                  step={5}
                  className="rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 transition focus:border-amber-400/50 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-100"
                />
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {formatOffset(offsetMinutes)}
                </span>
              </label>
            </div>
          )}
        </section>

        {error && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
            {error}
          </p>
        )}

        {notice && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300">
            {notice}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950 shadow-sm transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button
            type="button"
            onClick={deleteTask}
            disabled={deleting}
            className="rounded-xl border border-rose-200 px-4 py-2 text-sm text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/40 dark:text-rose-300 dark:hover:bg-rose-950/20"
          >
            {deleting ? 'Deleting…' : 'Delete task'}
          </button>
        </div>
      </form>

      <aside className="flex flex-col gap-4">
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/60">
          <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Snapshot
          </h2>
          <dl className="mt-4 flex flex-col gap-3 text-sm">
            <div className="flex flex-col gap-1">
              <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Status
              </dt>
              <dd className="text-zinc-900 dark:text-zinc-100">
                {task.completed_at ? 'Completed' : 'Open'}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Due
              </dt>
              <dd className="text-zinc-900 dark:text-zinc-100" title={exactDue ?? undefined}>
                {summaryDue}
                {exactDue && summaryDue !== exactDue ? (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">{exactDue}</div>
                ) : null}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Course
              </dt>
              <dd className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
                {course && (
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: course.color ?? '#6366f1' }}
                  />
                )}
                <span>{course?.name ?? 'No course'}</span>
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Created
              </dt>
              <dd className="text-zinc-900 dark:text-zinc-100">{createdAt}</dd>
            </div>
          </dl>
        </section>

        {task.capture_id && (
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/60">
            <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Source
            </h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              This task came from a captured note or assistant import.
            </p>
            <Link
              href={`/captures/${task.capture_id}`}
              className="mt-4 inline-flex text-sm text-zinc-700 underline decoration-zinc-300 underline-offset-4 transition hover:text-zinc-950 dark:text-zinc-300 dark:decoration-zinc-700 dark:hover:text-zinc-100"
            >
              Open source capture
            </Link>
          </section>
        )}

        {linkedEvent && (
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/60">
            <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Linked Class
            </h2>
            <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{linkedEvent.title}</p>
            {eventDisplayTime && (
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{eventDisplayTime}</p>
            )}
            {linkedEvent.location && (
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{linkedEvent.location}</p>
            )}
          </section>
        )}
      </aside>
    </div>
  );
}
