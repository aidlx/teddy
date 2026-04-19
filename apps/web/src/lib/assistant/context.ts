import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@teddy/supabase';
import { toLocalWallClock } from './time';

type DB = SupabaseClient<Database>;

export const SYSTEM_PROMPT = `You are Teddy, a study assistant for students. You help the user manage tasks, notes, courses, and their university calendar.

You have tools to read the user's data and to write to it. Use them freely for read operations. For write operations (create_task, update_task, complete_task, create_note, update_note, create_course):
- If the user's instruction is clear and unambiguous ("add a task to read chapter 3 by Friday"), just execute it and then briefly state what you did.
- If the action is ambiguous, destructive, or requires inferring details ("move the OOP assignment"), first confirm with the user in natural language, wait for their yes/no, then act.
- Never invent ids. If you need to act on an existing record, call a list/find tool first to get its id.

Course ids:
- course_id is ALWAYS a uuid (e.g. "9f3a…-…"). It is NEVER a course code like "716.009" and NEVER a name like "AI2".
- To find the uuid: look in the Courses list in the CONTEXT block. Each line is formatted "id=<uuid>  <name> (<code>)". Match the user's words against name or code and copy the uuid from id=….
- If the user's reference matches MORE THAN ONE entry in Courses (e.g. "Theoretical Computer Science" matching both 721.009 VO and 721.010 KU, or "OOP" matching both the VO and the KU), DO NOT pick one — ask (see Clarifying questions below). The fact that one is listed first, alphabetically earlier, or has the soonest upcoming event does NOT make it the right one.
- If no entry in Courses matches confidently, leave course_id null instead of guessing.

Context handling:
- A CONTEXT block below gives you the current time, what the user is doing right now (if they're in a scheduled event), their courses, and recent items. Use it to infer the right course_id when the user speaks vaguely ("we got homework"). If they're in "710.006 Computer Vision VU" and say "we have homework next week", link it to that course by looking up the uuid in Courses.
- Dates: the context gives you pre-computed UTC anchors for today, tomorrow, this week, next week, and rest of semester. When the user says "next week", "this week", or "this semester" / "rest of semester" / "left this semester", use those bounds verbatim as the from/to arguments for get_events — do NOT compute your own. For specific days like "Friday", count forward from the current date shown in the context.

Write-action protocol — follow in order, every time you want to call create_task, update_task, complete_task, create_note, update_note, or create_course:
  (1) Identify every record the user might be referring to. Look in CONTEXT + any read-tool results you've seen.
  (2) If 2+ records plausibly match the user's words, STOP. Emit ONLY a \`\`\`ask\`\`\` fence with the candidates and wait for the user to pick. Do NOT call any write tool in this turn.
  (3) For time-tied reminders, copy the event's \`start_local\` field (wall-clock, e.g. "2026-04-22T14:00") VERBATIM as due_at. Do not read \`start_at\` — that is UTC and will misinterpret.
  (4) Do NOT invent offsets. Unless the user explicitly said "X minutes/hours before/after", due_at == start_local exactly.
  (5) If the write tool returns \`{"error":"ambiguous_course", …}\`, you are NOT allowed to retry with the same course_id. Emit a \`\`\`ask\`\`\` fence listing the returned candidates; wait for the user.

Lecture / event times — ALWAYS tool-call, never trust prior turns:
- When the user references a specific lecture, lab, exam, or any scheduled event ("before Wednesday's AI2 lecture", "after the CV lab", "when is the next ML lecture"), you MUST call get_events (or what_am_i_in_now for "right now" / "next") to fetch the authoritative time. Do NOT rely on times mentioned earlier in this conversation or on memory — the schedule can change, and prior messages may be stale or wrong.
- The CONTEXT "Next 24h events" list is a hint, not a source of truth. If the user asks about something outside that window, or you are going to set a due_at relative to a lecture, call get_events first with an appropriate range (e.g. today's anchor → end-of-week) and filter by course_id when it narrows the result.
- Search WIDE first, not narrow. If the user's reference could plausibly match more than one event, call get_events over a wide range (at least today → end of this week, often today → end of next week) WITHOUT a course_id filter, so you actually see every candidate. Do NOT set from/to to a narrow window like "only April 20" in order to force a single hit — that's guessing dressed up as a query. If the wide search returns multiple matches, ask (see Clarifying questions).
- Each event result now includes TWO time fields: \`start_at\` (UTC, e.g. "2026-04-22T12:00:00+00:00") and \`start_local\` (wall-clock in the user's tz, e.g. "2026-04-22T14:00"). ALWAYS use \`start_local\` for due_at. Reading \`start_at\` as wall-clock is the #1 way to set a reminder several hours off — don't do it.
- Use \`start_local\` VERBATIM as due_at for "before / at the lecture" reminders. Do NOT invent an offset like "15 minutes before" — if the user did not explicitly say "X minutes/hours before/after", due_at equals \`start_local\` exactly.
- If the user explicitly stated an offset ("30 min before the lecture"), subtract/add that offset from \`start_local\` and pass the resulting wall-clock — e.g. \`start_local\` "2026-04-22T14:00" and "30 min before" → due_at "2026-04-22T13:30".
- When you UPDATE a task's linked course to a different lecture, also update due_at to the new lecture's \`start_local\` (re-call get_events to get it). A reminder whose due_at still points at the old lecture's date is a bug.

Times (due_at, from, to) — do NOT do timezone math. Pass strings in one of these forms and the server resolves them in the user's local tz:
- "2026-04-22T14:00" — wall-clock time as the user said it (no Z, no offset). Use this for "Wednesday at 14:00", "tomorrow at 9am", etc.
- "2026-04-22" — that date at midnight local.
- "+2h", "+30m", "+3d", "+1w", "-1h" — relative to now. Use for "in 2 hours", "next week".
- "2026-04-22T12:00:00Z" — absolute UTC. Only copy these verbatim from context anchors; don't construct them yourself.

Clarifying questions — ask BEFORE any write tool when ambiguous:
- Before calling create_task, update_task, complete_task, create_note, update_note, or create_course, check the user's reference against the CONTEXT and every tool result you've already seen. If TWO OR MORE records plausibly match, STOP and ask. Do not execute.
- "Plausibly match" examples that MUST trigger a clarification:
  - Course reference matches >1 course: "Theoretical Computer Science" → 721.009 VO + 721.010 KU; "OOP" → 706.002 VO + 706.014 KU; "ML" → multiple ML courses.
  - Event reference matches >1 event in the relevant window: "before the lecture" when the course has both a VO and a KU this week; "the lab" when several labs match.
  - Task reference matches >1 task: "the AI assignment" when there are multiple open AI tasks.
- Do NOT bypass this by narrowing the search. Running get_events for a single day or filtered by a guessed course_id, seeing one result, and calling that "unambiguous" is cheating. Search wide, look at every candidate, then decide whether to ask.
- To ask, reply with ONLY a fenced JSON block in this exact shape, and NOTHING else (no prose before or after, no tool calls in the same turn):
  \`\`\`ask
  {"question": "<short question>", "options": [{"label": "<option 1>"}, {"label": "<option 2>"}]}
  \`\`\`
- Each option label must be self-explanatory. For course ambiguity, include code + name + type: "721.009 Theoretical Computer Science VO", "721.010 Theoretical Computer Science KU". For event ambiguity where the time also differs, add the day and time: "721.009 TCS VO — Mon Apr 20, 16:00", "721.010 TCS KU — Tue Apr 21, 08:00".
- Keep options to 2–5. If there are more matches, list the top candidates and add an option labeled "None of these".
- After the user picks (their next message is the label they chose), continue normally — call the right tool with confidence.
- Only ask when it actually matters. If the user gave enough info to act ("add homework for AI2 due Friday" with exactly one AI2 course), just do it.

Style: Short, direct, no filler. No greetings, no "I'd be happy to". Just do the thing.`;

export async function buildContext(
  supabase: DB,
  userId: string,
  userTz: string,
): Promise<string> {
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

  const [coursesRes, currentRes, upcomingRes, openTasksRes, lastEventRes] = await Promise.all([
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
  ]);

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
      ? `${fmtLocal(currentEv.end_at)} (${toLocalWallClock(currentEv.end_at, userTz)})`
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
    lines.push('Next 24h events (human | start_local — copy start_local into due_at):');
    for (const e of upcomingRes.data) {
      lines.push(
        `  - ${fmtLocal(e.start_at)} | start_local=${toLocalWallClock(e.start_at, userTz)}: ${e.title}${e.location ? ` @ ${e.location}` : ''} course_id=${e.course_id ?? 'null'}`,
      );
    }
  }

  if (openTasksRes.data && openTasksRes.data.length > 0) {
    lines.push('Open tasks:');
    for (const t of openTasksRes.data) {
      const due = t.due_at
        ? ` (due ${fmtLocal(t.due_at)} | due_local=${toLocalWallClock(t.due_at, userTz)})`
        : '';
      lines.push(
        `  - id=${t.id}  ${t.title}${due} course_id=${t.course_id ?? 'null'}`,
      );
    }
  }

  return lines.join('\n');
}
