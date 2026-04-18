'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase/client';

interface Subscription {
  id: string;
  name: string;
  ical_url: string;
  last_synced_at: string | null;
  last_error: string | null;
}

interface EventRow {
  id: string;
  title: string;
  location: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  course_id: string | null;
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
  course_id: string | null;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function buildMonthGrid(monthStart: Date): Date[] {
  const first = new Date(monthStart);
  const weekday = (first.getDay() + 6) % 7;
  first.setDate(first.getDate() - weekday);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(first);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
}

function fmtMonth(d: Date) {
  return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function CalendarPage() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll() {
    const supabase = getBrowserSupabase();
    const [s, e, t, c] = await Promise.all([
      supabase.from('calendar_subscriptions').select('*').order('created_at'),
      supabase.from('events').select('*').order('start_at'),
      supabase.from('tasks').select('id, title, due_at, course_id').is('completed_at', null),
      supabase.from('courses').select('id, name, color'),
    ]);
    if (s.error) setError(s.error.message);
    setSubs(s.data ?? []);
    setEvents(e.data ?? []);
    setTasks(t.data ?? []);
    setCourses(c.data ?? []);
  }

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
    const res = await fetch('/api/calendar/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), ical_url: url.trim() }),
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

  const coursesById = useMemo(() => new Map(courses.map((c) => [c.id, c] as const)), [courses]);
  const days = useMemo(() => buildMonthGrid(cursor), [cursor]);
  const today = new Date();

  type CellItem =
    | { kind: 'event'; id: string; title: string; time: string | null; color: string | null; allDay: boolean }
    | { kind: 'task'; id: string; title: string; color: string | null };

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CellItem[]>();
    const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    for (const ev of events) {
      const d = new Date(ev.start_at);
      const k = key(d);
      const arr = map.get(k) ?? [];
      const course = ev.course_id ? coursesById.get(ev.course_id) : null;
      arr.push({
        kind: 'event',
        id: ev.id,
        title: ev.title,
        time: ev.all_day ? null : fmtTime(ev.start_at),
        color: course?.color ?? null,
        allDay: ev.all_day,
      });
      map.set(k, arr);
    }
    for (const t of tasks) {
      if (!t.due_at) continue;
      const d = new Date(t.due_at);
      const k = key(d);
      const arr = map.get(k) ?? [];
      const course = t.course_id ? coursesById.get(t.course_id) : null;
      arr.push({ kind: 'task', id: t.id, title: t.title, color: course?.color ?? null });
      map.set(k, arr);
    }
    return map;
  }, [events, tasks, coursesById]);

  const selectedItems = selected
    ? itemsByDay.get(`${selected.getFullYear()}-${selected.getMonth()}-${selected.getDate()}`) ?? []
    : [];

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
                <button
                  onClick={() => syncOne(s.id)}
                  disabled={syncing === s.id}
                  className="ml-auto text-xs text-zinc-600 underline decoration-zinc-300 underline-offset-4 transition hover:text-zinc-900 hover:decoration-zinc-500 disabled:opacity-40 dark:text-zinc-400 dark:decoration-zinc-700 dark:hover:text-zinc-100"
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

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="rounded-md px-2.5 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900/60 dark:hover:text-zinc-100"
          >
            ←
          </button>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold tracking-tight">{fmtMonth(cursor)}</h2>
            <button
              onClick={() => {
                setCursor(startOfMonth(new Date()));
                setSelected(new Date());
              }}
              className="text-xs text-zinc-500 underline decoration-zinc-300 underline-offset-4 transition hover:text-zinc-800 dark:decoration-zinc-700 dark:hover:text-zinc-200"
            >
              Today
            </button>
          </div>
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="rounded-md px-2.5 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900/60 dark:hover:text-zinc-100"
          >
            →
          </button>
        </div>

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
            const isToday = sameDay(d, today);
            const isSelected = selected && sameDay(d, selected);
            const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
            const items = itemsByDay.get(key) ?? [];
            return (
              <button
                key={key}
                onClick={() => setSelected(d)}
                className={`flex min-h-[5.5rem] flex-col items-start gap-0.5 bg-white px-1.5 py-1 text-left transition hover:bg-zinc-100 dark:bg-zinc-950 dark:hover:bg-zinc-900/60 ${
                  inMonth ? '' : 'text-zinc-400 dark:text-zinc-600'
                } ${isSelected ? 'ring-2 ring-amber-400 ring-inset' : ''}`}
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
                    <div
                      key={`${it.kind}-${it.id}-${i}`}
                      className="flex items-center gap-1 truncate rounded px-1 text-[10px] leading-tight"
                      style={{
                        backgroundColor: it.color
                          ? `${it.color}26`
                          : it.kind === 'task'
                            ? 'rgba(251,191,36,0.2)'
                            : 'rgba(99,102,241,0.15)',
                        color: it.color ?? undefined,
                      }}
                    >
                      {it.kind === 'event' && it.time && (
                        <span className="flex-none opacity-70">{it.time}</span>
                      )}
                      {it.kind === 'task' && <span className="flex-none opacity-70">✓</span>}
                      <span className="truncate text-zinc-800 dark:text-zinc-200">{it.title}</span>
                    </div>
                  ))}
                  {items.length > 3 && (
                    <div className="text-[10px] text-zinc-500">+{items.length - 3} more</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {selected && selectedItems.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {selected.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </h2>
          <ul className="flex flex-col gap-1.5">
            {selectedItems.map((it, i) => (
              <li
                key={`${it.kind}-${it.id}-${i}`}
                className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm dark:border-zinc-900 dark:bg-zinc-950/40"
              >
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
                    it.kind === 'task'
                      ? 'bg-amber-400/20 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300'
                      : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                  }`}
                >
                  {it.kind}
                </span>
                {it.color && (
                  <span
                    className="h-2 w-2 flex-none rounded-full"
                    style={{ backgroundColor: it.color }}
                  />
                )}
                <span className="truncate text-zinc-900 dark:text-zinc-100">{it.title}</span>
                {it.kind === 'event' && it.time && (
                  <span className="ml-auto flex-none text-xs text-zinc-500">{it.time}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
