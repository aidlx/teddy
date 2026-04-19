'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { TaskDetailModal } from '@/components/TaskDetailModal';
import { EventDetailModal } from '@/components/EventDetailModal';
import {
  currentDateKey,
  formatTaskDue,
  formatTaskDueExact,
  parseDateKey,
  taskDayKey,
} from '@/lib/format';

interface Subscription {
  id: string;
  name: string;
  ical_url: string;
  last_synced_at: string | null;
  last_error: string | null;
  tz: string;
}

interface EventRow {
  id: string;
  title: string;
  location: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  course_id: string | null;
  source_tz: string | null;
}

interface Course {
  id: string;
  name: string;
  color: string | null;
}

interface TaskRow {
  id: string;
  title: string;
  due_at: string | null;
  due_kind: string | null;
  due_tz: string | null;
  anchor_event_id: string | null;
  offset_minutes: number | null;
  course_id: string | null;
  completed_at: string | null;
}

type ActiveDetail = { kind: 'task' | 'event'; id: string } | null;

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function getTimezones(): string[] {
  type IntlWithSupported = { supportedValuesOf?: (key: string) => string[] };
  const values = (Intl as IntlWithSupported).supportedValuesOf?.('timeZone');
  if (values && values.length > 0) return values;
  return ['UTC', 'Europe/Vienna', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo'];
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(d: Date): Date {
  const weekday = (d.getDay() + 6) % 7;
  return addDays(d, -weekday);
}

function buildMonthGrid(monthStart: Date): Date[] {
  const first = startOfWeek(monthStart);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) days.push(addDays(first, i));
  return days;
}

function fmtMonth(d: Date) {
  return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

function fmtTime(iso: string, tz?: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  });
}

function dayKeyInTz(iso: string, tz?: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: tz,
  }).formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

function gridDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type CellItem =
  | {
      kind: 'event';
      id: string;
      title: string;
      time: string | null;
      color: string | null;
      allDay: boolean;
      sortMs: number;
    }
  | {
      kind: 'task';
      id: string;
      title: string;
      color: string | null;
      time: string | null;
      detail: string | null;
      exact: string | null;
      completed: boolean;
      sortMs: number;
    };

export default function CalendarPage() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [userTz, setUserTz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [cursor, setCursor] = useState(() => {
    const initialTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return parseDateKey(currentDateKey(initialTz));
  });
  const [selected, setSelected] = useState<Date>(() => {
    const initialTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return parseDateKey(currentDateKey(initialTz));
  });
  const [activeDetail, setActiveDetail] = useState<ActiveDetail>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');

  const loadAll = useCallback(async () => {
    const supabase = getBrowserSupabase();
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const [s, e, t, c, p] = await Promise.all([
      supabase.from('calendar_subscriptions').select('*').order('created_at'),
      supabase
        .from('events')
        .select('id, title, location, start_at, end_at, all_day, course_id, source_tz')
        .order('start_at'),
      supabase
        .from('tasks')
        .select(
          'id, title, due_at, due_kind, due_tz, anchor_event_id, offset_minutes, course_id, completed_at',
        ),
      supabase.from('courses').select('id, name, color'),
      supabase.from('profiles').select('timezone').maybeSingle(),
    ]);
    if (s.error) setError(s.error.message);
    if (e.error) setError(e.error.message);
    if (t.error) setError(t.error.message);
    if (c.error) setError(c.error.message);
    if (p.error) setError(p.error.message);
    setSubs(s.data ?? []);
    setEvents(e.data ?? []);
    setTasks(t.data ?? []);
    setCourses(c.data ?? []);
    setUserTz(p.data?.timezone ?? browserTz);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function readJson(res: Response): Promise<Record<string, unknown>> {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { error: text.slice(0, 200) || `HTTP ${res.status}` };
    }
  }

  async function addSubscription(ev: React.FormEvent) {
    ev.preventDefault();
    if (!name.trim() || !url.trim()) return;
    setAdding(true);
    setError(null);
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const res = await fetch('/api/calendar/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), ical_url: url.trim(), tz: browserTz }),
    });
    const data = await readJson(res);
    if (!res.ok) {
      setError(String(data.error ?? `Subscribe failed (${res.status})`));
    } else {
      setName('');
      setUrl('');
      setShowAdd(false);
      await loadAll();
    }
    setAdding(false);
  }

  async function syncOne(id: string) {
    setSyncing(id);
    setError(null);
    setNotice(null);
    const res = await fetch('/api/calendar/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription_id: id }),
    });
    const data = await readJson(res);
    if (!res.ok) {
      setError(String(data.error ?? `Sync failed (${res.status})`));
    } else {
      const results = (data.results ?? []) as Array<{
        result?: { inserted: number; updated: number; deleted: number; unchanged: number; coursesCreated: number };
        error?: string;
      }>;
      const r = results[0];
      if (r?.error) {
        setError(r.error);
      } else if (r?.result) {
        const { inserted, updated, deleted, coursesCreated } = r.result;
        const parts = [`+${inserted}`, `~${updated}`, `−${deleted}`];
        if (coursesCreated > 0) parts.push(`${coursesCreated} new course${coursesCreated === 1 ? '' : 's'}`);
        setNotice(`Synced: ${parts.join('  ')}`);
      }
      await loadAll();
    }
    setSyncing(null);
  }

  async function removeSub(id: string) {
    const res = await fetch(`/api/calendar/subscriptions/${id}`, { method: 'DELETE' });
    const data = await readJson(res);
    if (!res.ok) setError(String(data.error ?? `Delete failed (${res.status})`));
    else await loadAll();
  }

  async function updateTz(id: string, tz: string) {
    setError(null);
    setSubs((prev) => prev.map((s) => (s.id === id ? { ...s, tz } : s)));
    const res = await fetch(`/api/calendar/subscriptions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tz }),
    });
    const data = await readJson(res);
    if (!res.ok) {
      setError(String(data.error ?? `Update failed (${res.status})`));
      await loadAll();
    }
  }

  const coursesById = useMemo(() => new Map(courses.map((c) => [c.id, c] as const)), [courses]);
  const displayTz = useMemo(() => {
    return userTz || Intl.DateTimeFormat().resolvedOptions().timeZone;
  }, [userTz]);
  const todayKey = useMemo(() => currentDateKey(displayTz), [displayTz]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CellItem[]>();
    for (const ev of events) {
      const k = dayKeyInTz(ev.start_at, displayTz);
      const arr = map.get(k) ?? [];
      const course = ev.course_id ? coursesById.get(ev.course_id) : null;
      arr.push({
        kind: 'event',
        id: ev.id,
        title: ev.title,
        time: ev.all_day ? null : fmtTime(ev.start_at, displayTz),
        color: course?.color ?? null,
        allDay: ev.all_day,
        sortMs: ev.all_day ? 0 : new Date(ev.start_at).getTime(),
      });
      map.set(k, arr);
    }
    for (const t of tasks) {
      const k = taskDayKey(t, displayTz);
      if (!k) continue;
      const arr = map.get(k) ?? [];
      const course = t.course_id ? coursesById.get(t.course_id) : null;
      const isDateOnly = t.due_kind === 'date';
      arr.push({
        kind: 'task',
        id: t.id,
        title: t.title,
        color: course?.color ?? null,
        time: t.due_at && !isDateOnly ? fmtTime(t.due_at, displayTz) : null,
        detail: formatTaskDue(t, displayTz),
        exact: formatTaskDueExact(t, displayTz),
        completed: Boolean(t.completed_at),
        sortMs:
          t.due_at && !isDateOnly
            ? new Date(t.due_at).getTime()
            : 0,
      });
      map.set(k, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.sortMs - b.sortMs);
    }
    return map;
  }, [events, tasks, coursesById, displayTz]);

  function stepCursor(direction: 1 | -1) {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1));
  }

  function goToToday() {
    const today = parseDateKey(todayKey);
    setCursor(today);
    setSelected(today);
  }

  const headerLabel = fmtMonth(cursor);

  const openItem = (item: CellItem) => {
    setActiveDetail({ kind: item.kind, id: item.id });
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-6 md:px-6 md:py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Calendar</h1>
        <Link
          href="/"
          className="text-sm text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          ← Home
        </Link>
      </header>

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

      <section className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950/60">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Subscriptions
          </h2>
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="text-xs text-zinc-600 underline decoration-zinc-300 underline-offset-4 transition hover:text-zinc-900 hover:decoration-zinc-500 dark:text-zinc-400 dark:decoration-zinc-700 dark:hover:text-zinc-100"
          >
            {showAdd ? 'Cancel' : '+ Add iCal feed'}
          </button>
        </div>

        {showAdd && (
          <form onSubmit={addSubscription} className="flex flex-col gap-2 pt-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (e.g. University schedule)"
              required
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 transition focus:border-amber-400/50 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-100 dark:placeholder:text-zinc-600"
            />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://… or webcal://…"
              required
              type="url"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 transition focus:border-amber-400/50 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-100 dark:placeholder:text-zinc-600"
            />
            <button
              type="submit"
              disabled={adding}
              className="self-start rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950 shadow-sm shadow-amber-400/30 transition hover:bg-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-400/40 disabled:cursor-not-allowed disabled:opacity-40 dark:shadow-amber-400/20"
            >
              {adding ? 'Importing…' : 'Import'}
            </button>
          </form>
        )}

        {subs.length === 0 && !showAdd && (
          <p className="text-sm text-zinc-500">
            Paste the iCal link from your university or any calendar service to import events.
          </p>
        )}

        {subs.length > 0 && (
          <ul className="flex flex-col gap-1.5 pt-1">
            {subs.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-900 dark:bg-zinc-950/40"
              >
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{s.name}</span>
                <span className="truncate text-xs text-zinc-500">{s.ical_url}</span>
                {s.last_error ? (
                  <span className="text-xs text-rose-600 dark:text-rose-400" title={s.last_error}>
                    error
                  </span>
                ) : s.last_synced_at ? (
                  <span className="text-xs text-zinc-500">
                    synced {new Date(s.last_synced_at).toLocaleString()}
                  </span>
                ) : null}
                <label className="ml-auto flex items-center gap-1 text-xs text-zinc-500">
                  <span>tz</span>
                  <select
                    value={s.tz}
                    onChange={(e) => updateTz(s.id, e.target.value)}
                    className="rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-xs text-zinc-700 transition focus:border-amber-400/50 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200"
                  >
                    {getTimezones().map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={() => syncOne(s.id)}
                  disabled={syncing === s.id}
                  className="text-xs text-zinc-600 underline decoration-zinc-300 underline-offset-4 transition hover:text-zinc-900 hover:decoration-zinc-500 disabled:opacity-40 dark:text-zinc-400 dark:decoration-zinc-700 dark:hover:text-zinc-100"
                >
                  {syncing === s.id ? 'Syncing…' : 'Sync'}
                </button>
                <button
                  onClick={() => removeSub(s.id)}
                  className="text-xs text-zinc-500 transition hover:text-rose-600 dark:text-zinc-600 dark:hover:text-rose-400"
                  aria-label="Remove subscription"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => stepCursor(-1)}
              className="rounded-md px-2.5 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900/60 dark:hover:text-zinc-100"
              aria-label="Previous"
            >
              ←
            </button>
            <h2 className="text-lg font-semibold tracking-tight">{headerLabel}</h2>
            <button
              onClick={() => stepCursor(1)}
              className="rounded-md px-2.5 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900/60 dark:hover:text-zinc-100"
              aria-label="Next"
            >
              →
            </button>
            <button
              onClick={goToToday}
              className="ml-1 text-xs text-zinc-500 underline decoration-zinc-300 underline-offset-4 transition hover:text-zinc-800 dark:decoration-zinc-700 dark:hover:text-zinc-200"
            >
              Today
            </button>
          </div>
        </div>

        <MonthView
          cursor={cursor}
          todayKey={todayKey}
          selectedKey={gridDayKey(selected)}
          itemsByDay={itemsByDay}
          onSelectDay={(d) => setSelected(d)}
          onOpen={openItem}
        />
        <SelectedDayList day={selected} itemsByDay={itemsByDay} onOpen={openItem} />
      </section>

      {activeDetail?.kind === 'task' && (
        <TaskDetailModal
          taskId={activeDetail.id}
          userTz={displayTz}
          onClose={() => setActiveDetail(null)}
          onChanged={() => {
            void loadAll();
          }}
        />
      )}

      {activeDetail?.kind === 'event' && (
        <EventDetailModal
          eventId={activeDetail.id}
          userTz={displayTz}
          onClose={() => setActiveDetail(null)}
          onOpenTask={(taskId) => setActiveDetail({ kind: 'task', id: taskId })}
        />
      )}
    </main>
  );
}

function ItemPill({ item, onOpen }: { item: CellItem; onOpen: (it: CellItem) => void }) {
  const bg = item.color
    ? `${item.color}26`
    : item.kind === 'task'
      ? 'rgba(251,191,36,0.2)'
      : 'rgba(99,102,241,0.15)';
  return (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        onOpen(item);
      }}
      className="flex w-full items-center gap-1 truncate rounded px-1 text-left text-[10px] leading-tight transition hover:brightness-95 dark:hover:brightness-110"
      style={{ backgroundColor: bg, color: item.color ?? undefined }}
    >
      {item.kind === 'event' && item.time && (
        <span className="flex-none opacity-70">{item.time}</span>
      )}
      {item.kind === 'task' && (
        <span className="flex-none opacity-70">{item.time ?? '✓'}</span>
      )}
      <span
        className={`truncate text-zinc-800 dark:text-zinc-200 ${
          item.kind === 'task' && item.completed ? 'line-through opacity-60' : ''
        }`}
      >
        {item.title}
      </span>
    </button>
  );
}

function ItemRow({ item, onOpen }: { item: CellItem; onOpen: (it: CellItem) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="flex w-full items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-left text-sm transition hover:border-zinc-300 dark:border-zinc-900 dark:bg-zinc-950/40 dark:hover:border-zinc-700"
    >
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
          item.kind === 'task'
            ? 'bg-amber-400/20 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300'
            : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
        }`}
      >
        {item.kind}
      </span>
      {item.color && (
        <span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: item.color }} />
      )}
      <span
        className={`min-w-0 truncate text-zinc-900 dark:text-zinc-100 ${
          item.kind === 'task' && item.completed ? 'line-through opacity-60' : ''
        }`}
      >
        {item.title}
      </span>
      {item.kind === 'event' && item.time && (
        <span className="ml-auto flex-none text-xs tabular-nums text-zinc-500">{item.time}</span>
      )}
      {item.kind === 'task' && (
        <span
          className="ml-auto flex-none text-xs text-zinc-500"
          title={item.exact ?? undefined}
        >
          {item.time ?? item.detail}
        </span>
      )}
    </button>
  );
}

function MonthView({
  cursor,
  todayKey,
  selectedKey,
  itemsByDay,
  onSelectDay,
  onOpen,
}: {
  cursor: Date;
  todayKey: string;
  selectedKey: string;
  itemsByDay: Map<string, CellItem[]>;
  onSelectDay: (d: Date) => void;
  onOpen: (it: CellItem) => void;
}) {
  const days = useMemo(() => buildMonthGrid(startOfMonth(cursor)), [cursor]);
  return (
    <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-800">
      {WEEKDAYS.map((w) => (
        <div
          key={w}
          className="bg-white px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-950"
        >
          {w}
        </div>
      ))}
      {days.map((d) => {
        const inMonth = d.getMonth() === cursor.getMonth();
        const key = gridDayKey(d);
        const isToday = key === todayKey;
        const isSelected = key === selectedKey;
        const items = itemsByDay.get(key) ?? [];
        return (
          <div
            key={key}
            onClick={() => onSelectDay(d)}
            className={`flex min-h-[5.5rem] cursor-pointer flex-col items-start gap-0.5 px-1.5 py-1 text-left transition ${
              isSelected
                ? 'bg-amber-50 ring-1 ring-inset ring-amber-300 dark:bg-amber-400/10 dark:ring-amber-400/40'
                : 'bg-white hover:bg-zinc-100 dark:bg-zinc-950 dark:hover:bg-zinc-900/60'
            } ${inMonth ? '' : 'text-zinc-400 dark:text-zinc-600'}`}
            role="button"
            tabIndex={0}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') onSelectDay(d);
            }}
          >
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                isToday
                  ? 'bg-amber-400 font-semibold text-zinc-950'
                  : 'text-zinc-700 dark:text-zinc-300'
              } ${inMonth ? '' : 'text-zinc-400 dark:text-zinc-600'}`}
            >
              {d.getDate()}
            </span>
            <div className="flex w-full flex-col gap-0.5 overflow-hidden">
              {items.slice(0, 3).map((it, i) => (
                <ItemPill key={`${it.kind}-${it.id}-${i}`} item={it} onOpen={onOpen} />
              ))}
              {items.length > 3 && (
                <div className="text-[10px] text-zinc-500">+{items.length - 3} more</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SelectedDayList({
  day,
  itemsByDay,
  onOpen,
}: {
  day: Date;
  itemsByDay: Map<string, CellItem[]>;
  onOpen: (it: CellItem) => void;
}) {
  const key = gridDayKey(day);
  const items = itemsByDay.get(key) ?? [];
  const weekdayIndex = (day.getDay() + 6) % 7;
  const weekdayLabel = WEEKDAYS_LONG[weekdayIndex];
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950/60">
      <div className="flex items-baseline gap-3">
        <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          {weekdayLabel}
        </h3>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          {day.toLocaleDateString(undefined, {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Nothing scheduled.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((it, i) => (
            <li key={`${it.kind}-${it.id}-${i}`}>
              <ItemRow item={it} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

