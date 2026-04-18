import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [{ data: conv, error: convErr }, { data: messages, error: msgErr }] =
    await Promise.all([
      supabase
        .from('conversations')
        .select('id, title, created_at, updated_at')
        .eq('owner_id', user.id)
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('messages')
        .select('id, role, content, tool_calls, tool_call_id, name, created_at')
        .eq('owner_id', user.id)
        .eq('conversation_id', id)
        .order('created_at'),
    ]);

  if (convErr) return NextResponse.json({ error: convErr.message }, { status: 500 });
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

  return NextResponse.json({ conversation: conv, messages: messages ?? [] });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('owner_id', user.id)
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
