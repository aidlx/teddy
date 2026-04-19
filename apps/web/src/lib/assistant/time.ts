import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@teddy/supabase';

type DB = SupabaseClient<Database>;

const RELATIVE_RE = /^([+-])(\d+)\s*([smhdw])$/i;
const LOCAL_NAIVE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
};

export type RelativeUnit = 'minute' | 'hour' | 'day' | 'week';

export interface TimeRef {
  kind: 'absolute_utc' | 'date' | 'datetime' | 'relative';
  absolute_utc: string | null;
  date: string | null;
  datetime_local: string | null;
  relative_value: number | null;
  relative_unit: RelativeUnit | null;
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

interface LocalDateTimeParts extends LocalDateParts {
  hour: number;
  minute: number;
  second: number;
}

export function resolveTime(input: string, tz: string, now: Date = new Date()): string {
  const s = input.trim();
  if (!s) throw new Error('empty time string');

  if (s.toLowerCase() === 'now') return now.toISOString();

  const rel = RELATIVE_RE.exec(s);
  if (rel) {
    const sign = rel[1] === '-' ? -1 : 1;
    const n = Number(rel[2]);
    const unit = rel[3]!.toLowerCase();
    if (unit === 's' || unit === 'm' || unit === 'h') {
      const ms = UNIT_MS[unit];
      if (ms === undefined) throw new Error(`unknown time unit: ${rel[3]}`);
      return new Date(now.getTime() + sign * n * ms).toISOString();
    }

    const parts = getLocalDateTimeParts(now, tz);
    const targetDate = addCalendarDays(
      { year: parts.year, month: parts.month, day: parts.day },
      sign * n * (unit === 'w' ? 7 : 1),
    );
    return wallClockToUtcIso(
      targetDate.year,
      targetDate.month,
      targetDate.day,
      parts.hour,
      parts.minute,
      parts.second,
      tz,
    );
  }

  const date = LOCAL_DATE_RE.exec(s);
  if (date) {
    return wallClockToUtcIso(+date[1]!, +date[2]!, +date[3]!, 0, 0, 0, tz);
  }

  const naive = LOCAL_NAIVE_RE.exec(s);
  if (naive) {
    return wallClockToUtcIso(
      +naive[1]!,
      +naive[2]!,
      +naive[3]!,
      +naive[4]!,
      +naive[5]!,
      naive[6] ? +naive[6] : 0,
      tz,
    );
  }

  // Fall through: assume ISO 8601 with offset or Z.
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`unrecognized time: ${input}`);
  }
  return parsed.toISOString();
}

export function resolveTimeRef(ref: TimeRef, tz: string, now: Date = new Date()): string {
  switch (ref.kind) {
    case 'absolute_utc':
      if (!ref.absolute_utc) throw new Error('absolute_utc is required');
      return resolveTime(ref.absolute_utc, tz, now);
    case 'date':
      if (!ref.date) throw new Error('date is required');
      return resolveTime(ref.date, tz, now);
    case 'datetime':
      if (!ref.datetime_local) throw new Error('datetime_local is required');
      return resolveTime(ref.datetime_local, tz, now);
    case 'relative':
      if (!ref.relative_value || !ref.relative_unit) {
        throw new Error('relative_value and relative_unit are required');
      }
      return resolveRelative(ref.relative_value, ref.relative_unit, tz, now);
    default:
      throw new Error(`unsupported time ref kind: ${(ref as { kind: string }).kind}`);
  }
}

export function resolveRelative(
  value: number,
  unit: RelativeUnit,
  tz: string,
  now: Date = new Date(),
): string {
  if (!Number.isFinite(value) || value < 0) throw new Error('relative value must be >= 0');
  if (unit === 'minute') return new Date(now.getTime() + value * 60_000).toISOString();
  if (unit === 'hour') return new Date(now.getTime() + value * 3_600_000).toISOString();

  const parts = getLocalDateTimeParts(now, tz);
  const targetDate = addCalendarDays(
    { year: parts.year, month: parts.month, day: parts.day },
    value * (unit === 'week' ? 7 : 1),
  );
  return wallClockToUtcIso(
    targetDate.year,
    targetDate.month,
    targetDate.day,
    parts.hour,
    parts.minute,
    parts.second,
    tz,
  );
}

function wallClockToUtcIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  min: number,
  sec: number,
  tz: string,
): string {
  const asIfUtc = Date.UTC(year, month - 1, day, hour, min, sec);
  const firstOffset = tzOffsetMs(asIfUtc, tz);
  const guess = asIfUtc - firstOffset;
  const secondOffset = tzOffsetMs(guess, tz);
  const iso = new Date(asIfUtc - secondOffset).toISOString();
  const roundTrip = toLocalWallClock(iso, tz, sec !== 0);
  const expected = formatWallClock({ year, month, day, hour, minute: min, second: sec }, sec !== 0);
  if (roundTrip !== expected) {
    throw new Error(`nonexistent local time in ${tz}: ${expected}`);
  }
  const offsetCandidates = new Set<number>([firstOffset, secondOffset]);
  for (const hours of [-6, -3, -1, 1, 3, 6]) {
    offsetCandidates.add(tzOffsetMs(guess + hours * 3_600_000, tz));
  }
  for (const offset of offsetCandidates) {
    const altMs = asIfUtc - offset;
    if (altMs === Date.parse(iso)) continue;
    const altIso = new Date(altMs).toISOString();
    if (toLocalWallClock(altIso, tz, sec !== 0) === expected) {
      throw new Error(`ambiguous local time in ${tz}: ${expected}`);
    }
  }
  return iso;
}

function tzOffsetMs(epochMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(epochMs));
  const pick = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const wallAsUtc = Date.UTC(pick('year'), pick('month') - 1, pick('day'), pick('hour'), pick('minute'), pick('second'));
  return wallAsUtc - epochMs;
}

function getDateTimeParts(epochMs: number, tz: string, withSeconds = true): LocalDateTimeParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' as const } : {}),
  }).formatToParts(new Date(epochMs));
  const pick = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
    second: withSeconds ? pick('second') : 0,
  };
}

function getLocalDateTimeParts(date: Date, tz: string): LocalDateTimeParts {
  return getDateTimeParts(date.getTime(), tz, true);
}

function formatWallClock(parts: LocalDateTimeParts, withSeconds = false): string {
  const base = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  return withSeconds ? `${base}:${String(parts.second).padStart(2, '0')}` : base;
}

function formatDate(parts: LocalDateParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function addCalendarDays(parts: LocalDateParts, days: number): LocalDateParts {
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

function weekdayOf(parts: LocalDateParts): number {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

export function buildDateAnchors(tz: string, now: Date = new Date()) {
  const localNow = getLocalDateTimeParts(now, tz);
  const today = { year: localNow.year, month: localNow.month, day: localNow.day };
  const tomorrow = addCalendarDays(today, 1);
  const dayAfterTomorrow = addCalendarDays(today, 2);
  const daysSinceMonday = (weekdayOf(today) + 6) % 7;
  const thisMonday = addCalendarDays(today, -daysSinceMonday);
  const nextMonday = addCalendarDays(thisMonday, 7);
  const mondayAfterNext = addCalendarDays(thisMonday, 14);

  const startOf = (d: LocalDateParts) => wallClockToUtcIso(d.year, d.month, d.day, 0, 0, 0, tz);

  return {
    today: { from: startOf(today), to: startOf(tomorrow) },
    tomorrow: { from: startOf(tomorrow), to: startOf(dayAfterTomorrow) },
    thisWeek: { from: startOf(thisMonday), to: startOf(nextMonday) },
    nextWeek: { from: startOf(nextMonday), to: startOf(mondayAfterNext) },
  };
}

export function toLocalWallClock(utcIso: string, tz: string, withSeconds = false): string {
  return formatWallClock(getDateTimeParts(new Date(utcIso).getTime(), tz, withSeconds), withSeconds);
}

export function toLocalDate(utcIso: string, tz: string): string {
  const parts = getDateTimeParts(new Date(utcIso).getTime(), tz, false);
  return formatDate({ year: parts.year, month: parts.month, day: parts.day });
}

export function formatInTz(
  utcIso: string,
  tz: string,
  opts?: { weekday?: boolean; withTime?: boolean },
): string {
  return new Date(utcIso).toLocaleString('en-GB', {
    ...(opts?.weekday ? { weekday: 'short' as const } : {}),
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    ...(opts?.withTime === false
      ? {}
      : {
          hour: '2-digit' as const,
          minute: '2-digit' as const,
          hour12: false,
        }),
    timeZone: tz,
  });
}

type EventTimeRow = {
  start_at: string;
  end_at?: string | null;
  source_tz?: string | null;
};

type TaskTimeRow = {
  due_at: string | null;
  due_kind?: string | null;
  due_tz?: string | null;
  anchor_event_id?: string | null;
  offset_minutes?: number | null;
};

export function decorateEventTimes<T extends EventTimeRow>(
  row: T,
  viewerTz: string,
): T & {
  display_tz: string;
  start_local: string;
  end_local: string | null;
} {
  return {
    ...row,
    display_tz: viewerTz,
    start_local: toLocalWallClock(row.start_at, viewerTz),
    end_local: row.end_at ? toLocalWallClock(row.end_at, viewerTz) : null,
  };
}

export function decorateTaskTimes<T extends TaskTimeRow>(
  row: T,
  viewerTz: string,
): T & {
  due_local: string | null;
  due_date_local: string | null;
  due_display_tz: string | null;
} {
  const dueTz = row.due_tz || viewerTz;
  return {
    ...row,
    due_local:
      row.due_at && row.due_kind !== 'date'
        ? toLocalWallClock(row.due_at, viewerTz)
        : null,
    due_date_local: row.due_at ? toLocalDate(row.due_at, dueTz) : null,
    due_display_tz: row.due_at ? (row.due_kind === 'date' ? dueTz : viewerTz) : null,
  };
}

export function isValidTz(tz: string | undefined | null): tz is string {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function rememberUserTz(
  supabase: DB,
  userId: string,
  tz: string | undefined | null,
): Promise<void> {
  if (!isValidTz(tz)) return;
  const { data } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', userId)
    .maybeSingle();
  if (isValidTz(data?.timezone)) return;
  await supabase.from('profiles').update({ timezone: tz }).eq('id', userId);
}

export async function resolveUserTz(
  supabase: DB,
  userId: string,
  override?: string | null,
): Promise<string> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', userId)
    .maybeSingle();
  if (isValidTz(profile?.timezone)) return profile.timezone;
  if (isValidTz(override)) return override;
  const { data } = await supabase
    .from('calendar_subscriptions')
    .select('tz')
    .eq('owner_id', userId)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (isValidTz(data?.tz)) return data.tz;
  return 'UTC';
}
