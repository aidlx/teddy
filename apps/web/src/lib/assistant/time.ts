import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@teddy/supabase';

type DB = SupabaseClient<Database>;

const RELATIVE_RE = /^([+-])(\d+)\s*([smhdw])$/i;
const LOCAL_NAIVE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
};

export function resolveTime(input: string, tz: string, now: Date = new Date()): string {
  const s = input.trim();
  if (!s) throw new Error('empty time string');

  if (s.toLowerCase() === 'now') return now.toISOString();

  const rel = RELATIVE_RE.exec(s);
  if (rel) {
    const sign = rel[1] === '-' ? -1 : 1;
    const n = Number(rel[2]);
    const unit = rel[3]!.toLowerCase();
    const ms = UNIT_MS[unit];
    if (ms === undefined) throw new Error(`unknown time unit: ${rel[3]}`);
    return new Date(now.getTime() + sign * n * ms).toISOString();
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

// Two-pass: the offset at the target moment differs from the offset at the
// naive-as-UTC moment when we're near a DST boundary. A second iteration
// converges.
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
  return new Date(asIfUtc - secondOffset).toISOString();
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

export function isValidTz(tz: string | undefined | null): tz is string {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function resolveUserTz(
  supabase: DB,
  userId: string,
  override?: string | null,
): Promise<string> {
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
