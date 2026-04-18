import { NextResponse, type NextRequest } from 'next/server';
import { extractText, getDocumentProxy } from 'unpdf';
import { getServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const MAX_CHARS = 80_000; // trim absurd texts so we don't blow model context

export async function POST(request: NextRequest) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file required' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'file too large' }, { status: 413 });
  }

  const name = file.name || 'attachment';
  const type = (file.type || '').toLowerCase();

  try {
    if (type === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
      const buf = new Uint8Array(await file.arrayBuffer());
      const pdf = await getDocumentProxy(buf);
      const { text } = await extractText(pdf, { mergePages: true });
      const joined = Array.isArray(text) ? text.join('\n\n') : text;
      return NextResponse.json({
        text: joined.slice(0, MAX_CHARS),
        filename: name,
        truncated: joined.length > MAX_CHARS,
      });
    }

    // plain text / markdown / csv — anything we can decode as utf-8
    if (
      type.startsWith('text/') ||
      /\.(txt|md|csv|log|json|tsv)$/i.test(name)
    ) {
      const text = await file.text();
      return NextResponse.json({
        text: text.slice(0, MAX_CHARS),
        filename: name,
        truncated: text.length > MAX_CHARS,
      });
    }

    return NextResponse.json(
      { error: `unsupported file type: ${type || 'unknown'}` },
      { status: 415 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? 'Extraction failed' },
      { status: 500 },
    );
  }
}
