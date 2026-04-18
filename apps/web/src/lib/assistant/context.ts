import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@teddy/supabase';

type DB = SupabaseClient<Database>;

export const SYSTEM_PROMPT = `You are Teddy, a study assistant for students. You help the user manage tasks, notes, courses, and their university calendar.

You have tools to read the user's data and to write to it. Use them freely for read operations. For write operations (create_task, update_task, complete_task, create_note, update_note, create_course):
- If the user's instruction is clear and unambiguous ("add a task to read chapter 3 by Friday"), just execute it and then briefly state what you did.
- If the action is ambiguous, destructive, or requires inferring details ("move the OOP assignment"), first confirm with the user in natural language, wait for their yes/no, then act.
- Never invent ids. If you need to act on an existing record, call a list/find tool first to get its id.

Context handling:
- A CONTEXT block below gives you the current time, what the user is doing right now (if they're in a scheduled event), their courses, and recent items. Use it to infer the right course_id when the user speaks vaguely ("we got homework"). If they're in "710.006 Computer Vision VU" and say "we have homework next week", link it to that course.
- If you can't confidently match a course, leave course_id null instead of guessing.
- Dates: resolve "tomorrow", "Friday", "next week" relative to the current time in the context. All due_at values you pass to tools must be ISO 8601 UTC.

Style: Short, direct, no filler. No greetings, no "I'd be happy to". Just do the thing.`;

export async function buildContext(supabase: DB, userId: string): Promise<string> {
  const now = new Date();
  const nowIso = now.toISOString();
  const in24hIso = new Date(now.getTime() + 24 * 3600 * 1000).toISOString();

  const [coursesRes, currentRes, upcomingRes, openTasksRes] = await Promise.all([
    supabase
      .from('courses')
      .select('id, name, code')
      .eq('owner_id', userId)
      .order('created_at'),
    supabase
      .from('events')
      .select('id, title, location, start_at, end_at, course_id')
      .eq('owner_id', userId)
      .lte('start_at', nowIso)
      .gte('end_at', nowIso)
      .limit(3),
    supabase
      .from('events')
      .select('id, title, location, start_at, course_id')
      .eq('owner_id', userId)
      .gt('start_at', nowIso)
      .lte('start_at', in24hIso)
      .order('start_at')
      .limit(10),
    supabase
      .from('tasks')
      .select('id, title, due_at, course_id')
      .eq('owner_id', userId)
      .is('completed_at', null)
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(10),
  ]);

  const lines: string[] = ['CONTEXT'];
  lines.push(
    `Now: ${nowIso} (${now.toLocaleString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })})`,
  );

  const currentEv = currentRes.data?.[0];
  if (currentEv) {
    lines.push(
      `Currently in: "${currentEv.title}"${currentEv.location ? ` at ${currentEv.location}` : ''} (until ${currentEv.end_at ?? '?'}). course_id=${currentEv.course_id ?? 'null'}`,
    );
  } else {
    lines.push('Currently in: nothing scheduled');
  }

  if (coursesRes.data && coursesRes.data.length > 0) {
    lines.push('Courses:');
    for (const c of coursesRes.data) {
      lines.push(`  - id=${c.id}  ${c.name}${c.code ? ` (${c.code})` : ''}`);
    }
  } else {
    lines.push('Courses: (none)');
  }

  if (upcomingRes.data && upcomingRes.data.length > 0) {
    lines.push('Next 24h events:');
    for (const e of upcomingRes.data) {
      const when = new Date(e.start_at).toLocaleString(undefined, {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
      });
      lines.push(
        `  - ${when}: ${e.title}${e.location ? ` @ ${e.location}` : ''} course_id=${e.course_id ?? 'null'}`,
      );
    }
  }

  if (openTasksRes.data && openTasksRes.data.length > 0) {
    lines.push('Open tasks:');
    for (const t of openTasksRes.data) {
      lines.push(
        `  - id=${t.id}  ${t.title}${t.due_at ? ` (due ${t.due_at})` : ''} course_id=${t.course_id ?? 'null'}`,
      );
    }
  }

  return lines.join('\n');
}
