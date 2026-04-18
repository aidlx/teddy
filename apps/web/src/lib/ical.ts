import ical from 'node-ical';
import type { EventInstance, VEvent } from 'node-ical';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@teddy/supabase';

type EventRow = Database['public']['Tables']['events']['Insert'];

const COURSE_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#6366f1',
  '#a855f7',
  '#ec4899',
];

function textOf(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && 'val' in (v as Record<string, unknown>)) {
    const val = (v as { val: unknown }).val;
    return typeof val === 'string' ? val : null;
  }
  return null;
}

// Extracts "706.014" + "Object-Oriented Programming 1 KU" from a title like
// "706.014 Object-Oriented Programming 1 KU, Standardgruppe".
function parseCourseFromTitle(title: string): { code: string; name: string } | null {
  const m = title.match(/^(\d{3}\.\d{3})\s+(.+)$/);
  if (!m) return null;
  const name = m[2]!.replace(/,\s*(Standardgruppe|Gruppe\s+\S+).*$/i, '').trim();
  return { code: m[1]!, name };
}

function fallbackCourseFromTitle(title: string): { code: string; name: string } | null {
  // For calendars that don't carry LV codes — group by name stem with common
  // class-type suffixes stripped (VO/VU/KU/UE/SE/PV/LU/PS/AG…).
  const cleaned = title
    .replace(/,\s*(Standardgruppe|Gruppe\s+\S+).*$/i, '')
    .replace(/\s+(VO|VU|KU|UE|SE|PV|LU|PS|AG|LV)\s*$/i, '')
    .trim();
  if (!cleaned) return null;
  return { code: cleaned.toLowerCase(), name: cleaned };
}

export async function syncSubscription(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  subscriptionId: string,
  icalUrl: string,
): Promise<{ inserted: number; coursesCreated: number }> {
  const parsed = await ical.async.fromURL(icalUrl);

  const now = new Date();
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);

  const expanded: Array<{ event: VEvent; instance: EventInstance }> = [];
  for (const item of Object.values(parsed)) {
    if (!item || typeof item !== 'object') continue;
    if ((item as { type?: string }).type !== 'VEVENT') continue;
    const event = item as VEvent;
    const instances = ical.expandRecurringEvent(event, { from, to });
    for (const instance of instances) expanded.push({ event, instance });
  }

  // Unique course candidates keyed by code.
  const candidates = new Map<string, string>();
  for (const { event } of expanded) {
    const title = textOf(event.summary) ?? '';
    const parsed = parseCourseFromTitle(title) ?? fallbackCourseFromTitle(title);
    if (parsed) candidates.set(parsed.code, parsed.name);
  }

  const { data: existing } = await supabase
    .from('courses')
    .select('id, code')
    .eq('owner_id', ownerId);
  const byCode = new Map<string, string>();
  for (const c of existing ?? []) {
    if (c.code) byCode.set(c.code, c.id);
  }

  const missing = [...candidates.entries()].filter(([code]) => !byCode.has(code));
  let coursesCreated = 0;
  if (missing.length > 0) {
    const offset = existing?.length ?? 0;
    const newRows = missing.map(([code, name], i) => ({
      owner_id: ownerId,
      name,
      code,
      color: COURSE_COLORS[(offset + i) % COURSE_COLORS.length]!,
    }));
    const { data: inserted, error } = await supabase
      .from('courses')
      .insert(newRows)
      .select('id, code');
    if (error) throw new Error(error.message);
    for (const c of inserted ?? []) {
      if (c.code) byCode.set(c.code, c.id);
    }
    coursesCreated = inserted?.length ?? 0;
  }

  const rows: EventRow[] = expanded.map(({ event, instance }) => {
    const title = textOf(event.summary) ?? '(untitled)';
    const course = parseCourseFromTitle(title) ?? fallbackCourseFromTitle(title);
    const courseId = course ? byCode.get(course.code) ?? null : null;
    return {
      owner_id: ownerId,
      subscription_id: subscriptionId,
      course_id: courseId,
      source: 'ical',
      ical_uid: event.uid,
      title,
      location: textOf(event.location),
      description: textOf(event.description),
      start_at: instance.start.toISOString(),
      end_at: instance.end ? instance.end.toISOString() : null,
      all_day: instance.isFullDay,
    };
  });

  await supabase.from('events').delete().eq('subscription_id', subscriptionId);

  if (rows.length > 0) {
    const { error } = await supabase.from('events').insert(rows);
    if (error) throw new Error(error.message);
  }

  await supabase
    .from('calendar_subscriptions')
    .update({ last_synced_at: new Date().toISOString(), last_error: null })
    .eq('id', subscriptionId);

  return { inserted: rows.length, coursesCreated };
}
