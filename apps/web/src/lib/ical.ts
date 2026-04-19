import ical from 'node-ical';
import type { EventInstance, VEvent } from 'node-ical';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@teddy/supabase';

type EventRow = Database['public']['Tables']['events']['Row'];
type EventInsert = Database['public']['Tables']['events']['Insert'];
type EventUpdate = Database['public']['Tables']['events']['Update'];

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

export interface SyncResult {
  inserted: number;
  updated: number;
  deleted: number;
  unchanged: number;
  coursesCreated: number;
}

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

// Stable key for matching an iCal instance against a stored row:
// recurring events share UID but differ by start_at.
function matchKey(icalUid: string | null | undefined, startIso: string): string {
  return `${icalUid ?? ''}__${startIso}`;
}

function rowsEqual(
  existing: Pick<
    EventRow,
    'title' | 'location' | 'description' | 'end_at' | 'all_day' | 'course_id' | 'source_tz'
  >,
  incoming: EventInsert,
): boolean {
  return (
    existing.title === incoming.title &&
    (existing.location ?? null) === (incoming.location ?? null) &&
    (existing.description ?? null) === (incoming.description ?? null) &&
    (existing.end_at ?? null) === (incoming.end_at ?? null) &&
    existing.all_day === (incoming.all_day ?? false) &&
    (existing.course_id ?? null) === (incoming.course_id ?? null) &&
    existing.source_tz === incoming.source_tz
  );
}

export async function syncSubscription(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  subscriptionId: string,
  icalUrl: string,
): Promise<SyncResult> {
  const { data: subscription, error: subErr } = await supabase
    .from('calendar_subscriptions')
    .select('tz')
    .eq('id', subscriptionId)
    .maybeSingle();
  if (subErr) throw new Error(subErr.message);

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

  const { data: existingCourses } = await supabase
    .from('courses')
    .select('id, code')
    .eq('owner_id', ownerId);
  const byCode = new Map<string, string>();
  for (const c of existingCourses ?? []) {
    if (c.code) byCode.set(c.code, c.id);
  }

  const missing = [...candidates.entries()].filter(([code]) => !byCode.has(code));
  let coursesCreated = 0;
  if (missing.length > 0) {
    const offset = existingCourses?.length ?? 0;
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

  // Build incoming rows keyed for lookup.
  const incomingByKey = new Map<string, EventInsert>();
  for (const { event, instance } of expanded) {
    const title = textOf(event.summary) ?? '(untitled)';
    const course = parseCourseFromTitle(title) ?? fallbackCourseFromTitle(title);
    const courseId = course ? byCode.get(course.code) ?? null : null;
    const startIso = instance.start.toISOString();
    const sourceTz = instance.start.tz ?? event.start?.tz ?? subscription?.tz ?? 'UTC';
    const row: EventInsert = {
      owner_id: ownerId,
      subscription_id: subscriptionId,
      course_id: courseId,
      source: 'ical',
      source_tz: sourceTz,
      ical_uid: event.uid,
      title,
      location: textOf(event.location),
      description: textOf(event.description),
      start_at: startIso,
      end_at: instance.end ? instance.end.toISOString() : null,
      all_day: instance.isFullDay,
    };
    // If the feed has duplicates for the same (uid, start), last one wins.
    incomingByKey.set(matchKey(event.uid, startIso), row);
  }

  const { data: existingEvents, error: existingErr } = await supabase
    .from('events')
    .select('id, ical_uid, start_at, title, location, description, end_at, all_day, course_id, source_tz')
    .eq('subscription_id', subscriptionId);
  if (existingErr) throw new Error(existingErr.message);

  const existingByKey = new Map<
    string,
    Pick<
      EventRow,
      | 'id'
      | 'title'
      | 'location'
      | 'description'
      | 'end_at'
      | 'all_day'
      | 'course_id'
      | 'source_tz'
    >
  >();
  for (const e of existingEvents ?? []) {
    existingByKey.set(matchKey(e.ical_uid, e.start_at), e);
  }

  const toInsert: EventInsert[] = [];
  const toUpdate: Array<{ id: string; patch: EventUpdate }> = [];
  let unchanged = 0;

  for (const [key, incoming] of incomingByKey.entries()) {
    const existing = existingByKey.get(key);
    if (!existing) {
      toInsert.push(incoming);
      continue;
    }
    if (rowsEqual(existing, incoming)) {
      unchanged++;
      continue;
    }
    toUpdate.push({
      id: existing.id,
      patch: {
        title: incoming.title,
        location: incoming.location ?? null,
        description: incoming.description ?? null,
        end_at: incoming.end_at ?? null,
        all_day: incoming.all_day ?? false,
        course_id: incoming.course_id ?? null,
        source_tz: incoming.source_tz ?? 'UTC',
      },
    });
  }

  const toDeleteIds: string[] = [];
  for (const [key, existing] of existingByKey.entries()) {
    if (!incomingByKey.has(key)) toDeleteIds.push(existing.id);
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from('events').insert(toInsert);
    if (error) throw new Error(error.message);
  }

  for (const { id, patch } of toUpdate) {
    const { error } = await supabase.from('events').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  }

  if (toDeleteIds.length > 0) {
    const { error } = await supabase.from('events').delete().in('id', toDeleteIds);
    if (error) throw new Error(error.message);
  }

  await supabase
    .from('calendar_subscriptions')
    .update({ last_synced_at: new Date().toISOString(), last_error: null })
    .eq('id', subscriptionId);

  return {
    inserted: toInsert.length,
    updated: toUpdate.length,
    deleted: toDeleteIds.length,
    unchanged,
    coursesCreated,
  };
}
