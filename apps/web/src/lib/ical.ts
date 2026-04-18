import ical from 'node-ical';
import type { VEvent } from 'node-ical';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@teddy/supabase';

type EventRow = Database['public']['Tables']['events']['Insert'];

type Course = { id: string; name: string; code: string | null };

function textOf(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && 'val' in (v as Record<string, unknown>)) {
    const val = (v as { val: unknown }).val;
    return typeof val === 'string' ? val : null;
  }
  return null;
}

function matchCourse(title: string, courses: Course[]): string | null {
  const haystack = title.toLowerCase();
  for (const c of courses) {
    if (c.code && haystack.includes(c.code.toLowerCase())) return c.id;
    if (c.name && haystack.includes(c.name.toLowerCase())) return c.id;
  }
  return null;
}

export async function syncSubscription(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  subscriptionId: string,
  icalUrl: string,
): Promise<{ inserted: number }> {
  const parsed = await ical.async.fromURL(icalUrl);

  const now = new Date();
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);

  const { data: courseRows } = await supabase
    .from('courses')
    .select('id, name, code')
    .eq('owner_id', ownerId);
  const courses: Course[] = courseRows ?? [];

  const rows: EventRow[] = [];

  for (const item of Object.values(parsed)) {
    if (!item || typeof item !== 'object') continue;
    if ((item as { type?: string }).type !== 'VEVENT') continue;
    const event = item as VEvent;

    const title = textOf(event.summary) ?? '(untitled)';
    const location = textOf(event.location);
    const description = textOf(event.description);
    const courseId = matchCourse(title, courses);

    const instances = ical.expandRecurringEvent(event, { from, to });
    for (const inst of instances) {
      rows.push({
        owner_id: ownerId,
        subscription_id: subscriptionId,
        course_id: courseId,
        source: 'ical',
        ical_uid: event.uid,
        title,
        location,
        description,
        start_at: inst.start.toISOString(),
        end_at: inst.end ? inst.end.toISOString() : null,
        all_day: inst.isFullDay,
      });
    }
  }

  await supabase.from('events').delete().eq('subscription_id', subscriptionId);

  if (rows.length > 0) {
    const { error } = await supabase.from('events').insert(rows);
    if (error) throw new Error(error.message);
  }

  await supabase
    .from('calendar_subscriptions')
    .update({ last_synced_at: new Date().toISOString(), last_error: null })
    .eq('id', subscriptionId);

  return { inserted: rows.length };
}
