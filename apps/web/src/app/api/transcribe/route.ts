import { NextResponse, type NextRequest } from 'next/server';
import { transcribe } from '@teddy/ai';
import { getServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';

// ~25MB Whisper limit; cap generously here to reject obvious abuse early.
const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('audio');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'audio file required' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'audio too large' }, { status: 413 });
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const text = await transcribe(buf, { filename: file.name || 'audio.webm' });
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? 'Transcription failed' },
      { status: 500 },
    );
  }
}
