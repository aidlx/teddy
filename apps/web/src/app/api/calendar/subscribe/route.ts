import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/lib/supabase/server';
import { syncSubscription } from '@/lib/ical';

export const runtime = 'nodejs';

const SubscribeSchema = z.object({
  name: z.string().min(1).max(120),
  ical_url: z.string().url(),
});

export async function POST(request: NextRequest) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = SubscribeSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const url = parsed.data.ical_url.replace(/^webcal:/i, 'https:');

  const { data: subscription, error: subError } = await supabase
    .from('calendar_subscriptions')
    .insert({
      owner_id: user.id,
      name: parsed.data.name,
      ical_url: url,
    })
    .select()
    .single();
  if (subError) return NextResponse.json({ error: subError.message }, { status: 500 });

  try {
    const { inserted } = await syncSubscription(supabase, user.id, subscription.id, url);
    return NextResponse.json({ subscription, inserted });
  } catch (err) {
    const message = (err as Error).message ?? 'Sync failed';
    await supabase
      .from('calendar_subscriptions')
      .update({ last_error: message })
      .eq('id', subscription.id);
    return NextResponse.json({ subscription, error: message }, { status: 502 });
  }
}
