import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@teddy/supabase';
import { buildDateAnchors, formatInTz, toLocalDate, toLocalWallClock } from './time';

type DB = SupabaseClient<Database>;

export const SYSTEM_PROMPT = `You are Teddy, a study assistant for students. You help the user manage tasks, notes, courses, and their university calendar.

You have tools to read the user's data and to write to it. Use them freely for read operations. For write operations (create_task, update_task, complete_task, create_note, update_note, create_course):
- If the user's instruction is clear and unambiguous ("add a task to read chapter 3 by Friday"), execute it and briefly state what you did.
- If the action is ambiguous, destructive, or requires inferring details ("move the OOP assignment"), ask first.
- Never invent ids. If you need an existing task or event id, call a read tool first.

Context handling:
- The CONTEXT block below gives you the canonical user timezone, current time, date anchors, what the user is in right now, their courses, recent events, and open tasks.
- Interpret words like "today", "tomorrow", "Friday", "next week", and "at 9" in the user's timezone shown in CONTEXT.
- The date anchors are already converted into UTC query bounds for the user's local day/week. When the user says "today", "tomorrow", "this week", "next week", or "rest of semester", copy those anchor values verbatim into get_events via absolute_utc time refs.

Write-action protocol — follow in order whenever you want to call create_task, update_task, complete_task, create_note, update_note, or create_course:
  (1) Identify every record the user might be referring to. Look in CONTEXT + any read-tool results you've seen.
  (2) If 2+ records plausibly match the user's words, STOP. Call \`request_clarification\` with explicit options and wait for the user to pick. Do NOT call any write tool in this turn.
  (3) For task due times, DO NOT pass a free-form time string. Always fill the typed \`due\` object the tool expects.
  (4) If a due time is tied to a scheduled event, you MUST call get_events (or what_am_i_in_now), then use \`due.kind="event"\` with the returned \`event_id\` and an explicit \`offset_minutes\`.
  (5) Use \`offset_minutes=0\` when the reminder should fire at the event start. Use negative numbers for "before" and positive numbers for "after". Example: "30 min before" => \`offset_minutes=-30\`.
  (6) If a write tool returns \`{"error":"ambiguous_course", …}\` or \`{"error":"course_event_mismatch", …}\`, do not retry blindly. Call \`request_clarification\`.

Lecture / event times — ALWAYS tool-call, never trust prior turns:
- When the user references a specific lecture, lab, exam, or scheduled event, call get_events (or what_am_i_in_now) to fetch the authoritative event id and time. Do not rely on memory or prior turns.
- Search wide first, not narrow. If the reference might match multiple events, query at least today → end of this week, often today → end of next week, without forcing a guessed course filter.
- Event rows contain \`start_local\` / \`end_local\` in the user's canonical timezone and \`display_tz\` telling you which timezone those wall-clock values use. \`source_tz\` is only provenance from the source calendar import. Use the event id for scheduling. Use the local wall-clock fields only when you need to explain the time in prose.

Typed time objects:
- get_events expects \`from\` and \`to\` objects with \`kind\` set to one of:
  - \`absolute_utc\` for a CONTEXT anchor you copied verbatim
  - \`date\` for a whole local calendar day
  - \`datetime\` for a specific local wall-clock time
  - \`relative\` for "in 2 hours" / "in 3 days" / "in 1 week"
- create_task / update_task expect a \`due\` object with \`kind\`:
  - \`none\` to clear/remove the due time
  - \`date\` for date-only deadlines like "by Friday"
  - \`datetime\` for exact local times like "tomorrow at 09:00"
  - \`relative\` for "in 2 hours"
  - \`absolute_utc\` only when copying a CONTEXT anchor exactly
  - \`event\` for reminders tied to a lecture/lab/exam, using \`event_id\` + \`offset_minutes\`

Clarifying questions — ask BEFORE any write tool when ambiguous:
- Before calling create_task, update_task, complete_task, create_note, update_note, or create_course, check the user's reference against the CONTEXT and every tool result you've already seen. If TWO OR MORE records plausibly match, STOP and ask. Do not execute.
- "Plausibly match" examples that MUST trigger a clarification:
  - Course reference matches >1 course: "Theoretical Computer Science" → 721.009 VO + 721.010 KU; "OOP" → 706.002 VO + 706.014 KU; "ML" → multiple ML courses.
  - Event reference matches >1 event in the relevant window: "before the lecture" when the course has both a VO and a KU this week; "the lab" when several labs match.
  - Task reference matches >1 task: "the AI assignment" when there are multiple open AI tasks.
- Do NOT bypass this by narrowing the search. Running get_events for a single day or filtered by a guessed course_id, seeing one result, and calling that "unambiguous" is cheating. Search wide, look at every candidate, then decide whether to ask.
- To ask, call \`request_clarification\` with:
  - \`question\`: a short direct question
  - \`options\`: 2-5 explicit option labels
- The platform will render the options and may canonicalize short user replies like "first", "the KU one", or "none of these" into one of your option labels on the next turn.
- For write clarifications, the platform may resume the blocked action directly after the user's choice, without asking you to reconstruct it from scratch.
- If the user clarified which course/event to use, discard stale ids from the rejected option. If a tool returns \`course_event_mismatch\`, re-run \`get_events\` for the chosen option and retry with the new \`event_id\`. Do not ask the same clarification twice unless the re-query is itself still ambiguous.
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
  const anchors = buildDateAnchors(userTz, now);

  const [coursesRes, currentRes, upcomingRes, openTasksRes, lastEventRes] = await Promise.all([
    supabase
      .from('courses')
      .select('id, name, code')
      .eq('owner_id', userId)
      .order('created_at'),
    supabase
      .from('events')
      .select('id, title, location, start_at, end_at, course_id, source_tz')
      .eq('owner_id', userId)
      .lte('start_at', nowIso)
      .gte('end_at', nowIso)
      .limit(3),
    supabase
      .from('events')
      .select('id, title, location, start_at, end_at, course_id, source_tz')
      .eq('owner_id', userId)
      .gt('start_at', nowIso)
      .lte('start_at', in24hIso)
      .order('start_at')
      .limit(10),
    supabase
      .from('tasks')
      .select('id, title, due_at, due_kind, due_tz, anchor_event_id, offset_minutes, course_id')
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

  const lines: string[] = ['CONTEXT'];
  lines.push(`User timezone: ${userTz}`);
  lines.push(`Now (UTC):   ${nowIso}`);
  lines.push(`Now (local): ${formatInTz(nowIso, userTz, { weekday: true })}`);
  lines.push('Date anchors (already UTC query bounds for the user timezone, copy verbatim via absolute_utc refs):');
  lines.push(`  today:           ${anchors.today.from} → ${anchors.today.to}`);
  lines.push(`  tomorrow:        ${anchors.tomorrow.from} → ${anchors.tomorrow.to}`);
  lines.push(`  this week (Mon–Sun): ${anchors.thisWeek.from} → ${anchors.thisWeek.to}`);
  lines.push(`  next week (Mon–Sun): ${anchors.nextWeek.from} → ${anchors.nextWeek.to}`);
  // End-of-semester = the last scheduled event we have on file, rounded up to
  // the next day (exclusive bound for range queries). If we have no future
  // events, fall back to 120 days out so the model still has *something*.
  const lastEvIso = lastEventRes.data?.[0]?.start_at;
  const semesterEnd = lastEvIso
    ? new Date(new Date(lastEvIso).getTime() + 24 * 3600 * 1000)
    : new Date(now.getTime() + 120 * 24 * 3600 * 1000);
  lines.push(`  rest of semester: ${nowIso} → ${semesterEnd.toISOString()}`);

  const currentEv = currentRes.data?.[0];
  if (currentEv) {
    const until = currentEv.end_at
      ? `${formatInTz(currentEv.end_at, userTz, { weekday: true })} (${toLocalWallClock(currentEv.end_at, userTz)})`
      : '?';
    lines.push(
      `Currently in: "${currentEv.title}"${currentEv.location ? ` at ${currentEv.location}` : ''} (until ${until}). display_tz=${userTz} source_tz=${currentEv.source_tz ?? userTz} course_id=${currentEv.course_id ?? 'null'}`,
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
      lines.push(
        `  - id=${e.id}  ${formatInTz(e.start_at, userTz, { weekday: true })} | display_tz=${userTz} | source_tz=${e.source_tz ?? userTz} | start_local=${toLocalWallClock(e.start_at, userTz)}: ${e.title}${e.location ? ` @ ${e.location}` : ''} course_id=${e.course_id ?? 'null'}`,
      );
    }
  }

  if (openTasksRes.data && openTasksRes.data.length > 0) {
    lines.push('Open tasks:');
    for (const t of openTasksRes.data) {
      const due = t.due_at
        ? t.due_kind === 'date'
          ? ` (due on ${toLocalDate(t.due_at, t.due_tz ?? userTz)} | due_kind=date | due_tz=${t.due_tz ?? userTz})`
          : ` (due ${formatInTz(t.due_at, userTz, { weekday: true })} | due_local=${toLocalWallClock(t.due_at, userTz)} | due_kind=${t.due_kind ?? 'datetime'}${t.anchor_event_id ? ` | anchor_event_id=${t.anchor_event_id} | offset_minutes=${t.offset_minutes ?? 0}` : ''})`
        : '';
      lines.push(
        `  - id=${t.id}  ${t.title}${due} course_id=${t.course_id ?? 'null'}`,
      );
    }
  }

  return lines.join('\n');
}
