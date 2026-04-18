import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@teddy/supabase';

type DB = SupabaseClient<Database>;

export const SYSTEM_PROMPT = `You are Teddy, a study assistant for students. You help the user manage tasks, notes, courses, and their university calendar.

You have tools to read the user's data and to write to it. Use them freely for read operations. For write operations (create_task, update_task, complete_task, create_note, update_note, create_course):
- If the user's instruction is clear and unambiguous ("add a task to read chapter 3 by Friday"), just execute it and then briefly state what you did.
- If the action is ambiguous, destructive, or requires inferring details ("move the OOP assignment"), first confirm with the user in natural language, wait for their yes/no, then act.
- Never invent ids. If you need to act on an existing record, call a list/find tool first to get its id.

Course ids:
- course_id is ALWAYS a uuid (e.g. "9f3a…-…"). It is NEVER a course code like "716.009" and NEVER a name like "AI2".
- To find the uuid: look in the Courses list in the CONTEXT block. Each line is formatted "id=<uuid>  <name> (<code>)". Match the user's words against name or code and copy the uuid from id=….
- If no entry in Courses matches confidently, leave course_id null instead of guessing.

Context handling:
- A CONTEXT block below gives you the current time, what the user is doing right now (if they're in a scheduled event), their courses, and recent items. Use it to infer the right course_id when the user speaks vaguely ("we got homework"). If they're in "710.006 Computer Vision VU" and say "we have homework next week", link it to that course by looking up the uuid in Courses.
- Dates: the context gives you pre-computed UTC anchors for today, tomorrow, this week, next week, and rest of semester. When the user says "next week", "this week", or "this semester" / "rest of semester" / "left this semester", use those bounds verbatim as the from/to arguments for get_events — do NOT compute your own. For specific days like "Friday", count forward from the current date shown in the context.

Timezones (IMPORTANT — read carefully):
- The user's local timezone is shown as "User timezone: <IANA>" in the CONTEXT block. When the user says a wall-clock time like "14:00", "2pm", "Wednesday at 8", they ALWAYS mean that time in their local tz. NEVER interpret it as UTC.
- Events shown in CONTEXT include both the raw UTC start_at AND a human-readable time in the user's local tz — use the local time to reason about "before X lecture" / "after Y", then convert the answer to UTC for the tool call.
- All due_at / from / to values you pass to tools MUST be ISO 8601 UTC. To convert: take the wall-clock time the user meant, apply the UTC offset for their tz on that date (remember DST — e.g. Europe/Vienna is UTC+1 in winter, UTC+2 in summer). When unsure, pick an UTC value that corresponds to the user's intended local time; do not echo the number verbatim with a Z suffix.
- Example: user is in Europe/Vienna (currently CEST, UTC+2) and says "remind me at 14:00 on April 22". Correct due_at is "2026-04-22T12:00:00Z", NOT "2026-04-22T14:00:00Z".

Style: Short, direct, no filler. No greetings, no "I'd be happy to". Just do the thing.`;

export async function buildContext(supabase: DB, userId: string): Promise<string> {
  const now = new Date();
  const nowIso = now.toISOString();
  const in24hIso = new Date(now.getTime() + 24 * 3600 * 1000).toISOString();

  // Pre-compute common date anchors so the model doesn't have to do date math
  // (LLMs are unreliable at "today + 7"). All bounds are UTC day-start, week
  // boundaries Monday 00:00 UTC → next Monday 00:00 UTC.
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 3600 * 1000);
  const dayAfterStart = new Date(todayStart.getTime() + 48 * 3600 * 1000);
  // Monday = 1 in getUTCDay() (0 = Sunday). Compute days since last Monday.
  const dow = todayStart.getUTCDay();
  const daysSinceMon = (dow + 6) % 7;
  const thisMonStart = new Date(todayStart.getTime() - daysSinceMon * 24 * 3600 * 1000);
  const nextMonStart = new Date(thisMonStart.getTime() + 7 * 24 * 3600 * 1000);
  const mondayAfterNextStart = new Date(thisMonStart.getTime() + 14 * 24 * 3600 * 1000);

  const [coursesRes, currentRes, upcomingRes, openTasksRes, lastEventRes, tzRes] = await Promise.all([
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
    // Latest scheduled event — proxy for semester end. Beats hardcoding
    // academic-calendar dates that vary by country/university.
    supabase
      .from('events')
      .select('start_at')
      .eq('owner_id', userId)
      .gte('start_at', nowIso)
      .order('start_at', { ascending: false })
      .limit(1),
    // User's timezone — first subscription's tz is our best guess.
    supabase
      .from('calendar_subscriptions')
      .select('tz')
      .eq('owner_id', userId)
      .order('created_at')
      .limit(1)
      .maybeSingle(),
  ]);

  const userTz = tzRes.data?.tz ?? 'UTC';
  const fmtLocal = (iso: string) =>
    new Date(iso).toLocaleString('en-GB', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: userTz,
    });

  const lines: string[] = ['CONTEXT'];
  lines.push(`User timezone: ${userTz}`);
  lines.push(`Now (UTC):   ${nowIso}`);
  lines.push(`Now (local): ${fmtLocal(nowIso)}`);
  lines.push('Date anchors (UTC, use these verbatim as from/to bounds):');
  lines.push(`  today:           ${todayStart.toISOString()} → ${tomorrowStart.toISOString()}`);
  lines.push(`  tomorrow:        ${tomorrowStart.toISOString()} → ${dayAfterStart.toISOString()}`);
  lines.push(`  this week (Mon–Sun): ${thisMonStart.toISOString()} → ${nextMonStart.toISOString()}`);
  lines.push(`  next week (Mon–Sun): ${nextMonStart.toISOString()} → ${mondayAfterNextStart.toISOString()}`);
  // End-of-semester = the last scheduled event we have on file, rounded up to
  // the next day (exclusive bound for range queries). If we have no future
  // events, fall back to 120 days out so the model still has *something*.
  const lastEvIso = lastEventRes.data?.[0]?.start_at;
  const semesterEnd = lastEvIso
    ? new Date(new Date(lastEvIso).getTime() + 24 * 3600 * 1000)
    : new Date(todayStart.getTime() + 120 * 24 * 3600 * 1000);
  lines.push(`  rest of semester: ${nowIso} → ${semesterEnd.toISOString()}`);

  const currentEv = currentRes.data?.[0];
  if (currentEv) {
    const until = currentEv.end_at
      ? `${fmtLocal(currentEv.end_at)} local / ${currentEv.end_at}`
      : '?';
    lines.push(
      `Currently in: "${currentEv.title}"${currentEv.location ? ` at ${currentEv.location}` : ''} (until ${until}). course_id=${currentEv.course_id ?? 'null'}`,
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
    lines.push('Next 24h events (local | UTC):');
    for (const e of upcomingRes.data) {
      lines.push(
        `  - ${fmtLocal(e.start_at)} | ${e.start_at}: ${e.title}${e.location ? ` @ ${e.location}` : ''} course_id=${e.course_id ?? 'null'}`,
      );
    }
  }

  if (openTasksRes.data && openTasksRes.data.length > 0) {
    lines.push('Open tasks:');
    for (const t of openTasksRes.data) {
      const due = t.due_at ? ` (due ${fmtLocal(t.due_at)} local / ${t.due_at})` : '';
      lines.push(
        `  - id=${t.id}  ${t.title}${due} course_id=${t.course_id ?? 'null'}`,
      );
    }
  }

  return lines.join('\n');
}
