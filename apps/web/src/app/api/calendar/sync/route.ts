import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/lib/supabase/server';
import { syncSubscription, type SyncResult } from '@/lib/ical';

export const runtime = 'nodejs';

const STALE_MS = 10 * 60 * 1000;

const SyncSchema = z.object({
  subscription_id: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = SyncSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { data: subs, error } = await supabase
    .from('calendar_subscriptions')
    .select('id, ical_url, last_synced_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const staleCutoff = Date.now() - STALE_MS;
  const filtered = (subs ?? []).filter((s) => {
    if (parsed.data.subscription_id) return s.id === parsed.data.subscription_id;
    if (!s.last_synced_at) return true;
    return new Date(s.last_synced_at).getTime() < staleCutoff;
  });

  const results: Array<{ id: string; result?: SyncResult; error?: string }> = [];
  for (const sub of filtered) {
    try {
      const result = await syncSubscription(supabase, user.id, sub.id, sub.ical_url);
      results.push({ id: sub.id, result });
    } catch (err) {
      const message = (err as Error).message ?? 'Sync failed';
      await supabase
        .from('calendar_subscriptions')
        .update({ last_error: message })
        .eq('id', sub.id);
      results.push({ id: sub.id, error: message });
    }
  }

  return NextResponse.json({ results, skipped: (subs?.length ?? 0) - filtered.length });
}
