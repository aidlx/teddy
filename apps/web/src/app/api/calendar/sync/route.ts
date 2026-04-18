import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/lib/supabase/server';
import { syncSubscription } from '@/lib/ical';

export const runtime = 'nodejs';

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

  let query = supabase.from('calendar_subscriptions').select('id, ical_url');
  if (parsed.data.subscription_id) {
    query = query.eq('id', parsed.data.subscription_id);
  }
  const { data: subs, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: Array<{ id: string; inserted?: number; error?: string }> = [];
  for (const sub of subs ?? []) {
    try {
      const { inserted } = await syncSubscription(supabase, user.id, sub.id, sub.ical_url);
      results.push({ id: sub.id, inserted });
    } catch (err) {
      const message = (err as Error).message ?? 'Sync failed';
      await supabase
        .from('calendar_subscriptions')
        .update({ last_error: message })
        .eq('id', sub.id);
      results.push({ id: sub.id, error: message });
    }
  }

  return NextResponse.json({ results });
}
