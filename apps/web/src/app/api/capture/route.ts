import { NextResponse, type NextRequest } from 'next/server';
import { parseCapture } from '@teddy/ai';
import { CaptureRequestSchema, type CourseHint } from '@teddy/shared';
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

  let ai;
  try {
    ai = await parseCapture(parsed.data.text, { courses: courseHints });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  // Validate course_id really belongs to this user (AI could hallucinate a bogus one).
  const validCourseId =
    ai.course_id && courseHints.some((c) => c.id === ai.course_id) ? ai.course_id : null;

  if (ai.type === 'task') {
    const { data, error } = await supabase
      .from('tasks')
      .insert({
        owner_id: user.id,
        course_id: validCourseId,
        title: ai.title,
        description: ai.description ?? null,
        due_at: ai.due_at ?? null,
        raw_capture: parsed.data.text,
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ kind: 'task', item: data });
  }

  const { data, error } = await supabase
    .from('notes')
    .insert({
      owner_id: user.id,
      course_id: validCourseId,
      title: ai.title ?? null,
      content: ai.content,
      raw_capture: parsed.data.text,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ kind: 'note', item: data });
}
