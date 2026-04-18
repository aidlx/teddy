import { NextResponse, type NextRequest } from 'next/server';
import { parseCapture } from '@teddy/ai';
import { CaptureRequestSchema, type CourseHint, type ParsedItem } from '@teddy/shared';
import type { Json } from '@teddy/supabase';
import { getServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = CaptureRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { data: courses, error: coursesError } = await supabase
    .from('courses')
    .select('id, name, code')
    .order('created_at', { ascending: true });

  if (coursesError) {
    return NextResponse.json({ error: coursesError.message }, { status: 500 });
  }

  const courseHints: CourseHint[] = (courses ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    code: c.code,
  }));
  const courseIds = new Set(courseHints.map((c) => c.id));

  let ai;
  try {
    ai = await parseCapture(parsed.data.text, { courses: courseHints });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  // Store the capture row first so every derived item can point back to it.
  const { data: capture, error: captureError } = await supabase
    .from('captures')
    .insert({
      owner_id: user.id,
      raw_text: parsed.data.text,
      parsed_json: ai as unknown as Json,
    })
    .select()
    .single();
  if (captureError) return NextResponse.json({ error: captureError.message }, { status: 500 });

  const created: Array<{ kind: 'task' | 'note'; item: Record<string, unknown> }> = [];

  for (const item of ai.items) {
    const validCourseId = item.course_id && courseIds.has(item.course_id) ? item.course_id : null;
    const row = await insertItem(supabase, user.id, capture.id, validCourseId, item);
    if ('error' in row) return NextResponse.json({ error: row.error }, { status: 500 });
    created.push(row);
  }

  return NextResponse.json({ captureId: capture.id, items: created });
}

async function insertItem(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  ownerId: string,
  captureId: string,
  courseId: string | null,
  item: ParsedItem,
): Promise<{ kind: 'task' | 'note'; item: Record<string, unknown> } | { error: string }> {
  if (item.type === 'task') {
    const { data, error } = await supabase
      .from('tasks')
      .insert({
        owner_id: ownerId,
        capture_id: captureId,
        course_id: courseId,
        title: item.title,
        description: item.description ?? null,
        due_at: item.due_at ?? null,
      })
      .select()
      .single();
    if (error) return { error: error.message };
    return { kind: 'task', item: data };
  }

  const { data, error } = await supabase
    .from('notes')
    .insert({
      owner_id: ownerId,
      capture_id: captureId,
      course_id: courseId,
      title: item.title ?? null,
      content: item.content,
    })
    .select()
    .single();
  if (error) return { error: error.message };
  return { kind: 'note', item: data };
}
