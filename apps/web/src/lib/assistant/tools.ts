import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@teddy/supabase';
import type { AgentTool } from '@teddy/ai';
import {
  resolveTimeRef,
  decorateEventTimes,
  decorateTaskTimes,
  toLocalWallClock,
  type RelativeUnit,
  type TimeRef,
} from './time';

type DB = SupabaseClient<Database>;
type TaskUpdate = Database['public']['Tables']['tasks']['Update'];
type NoteUpdate = Database['public']['Tables']['notes']['Update'];
type CourseRow = Pick<Database['public']['Tables']['courses']['Row'], 'id' | 'name' | 'code'>;
type EventAnchorRow = Pick<
  Database['public']['Tables']['events']['Row'],
  'id' | 'title' | 'start_at' | 'source_tz' | 'course_id'
>;

type CourseResolution =
  | { kind: 'none' }
  | { kind: 'match'; course: CourseRow }
  | { kind: 'ambiguous'; matches: CourseRow[] };

type TimeRefInput = TimeRef;
type ResolvedDue = Pick<
  TaskUpdate,
  'due_at' | 'due_kind' | 'due_tz' | 'anchor_event_id' | 'offset_minutes'
> & {
  anchorEvent: EventAnchorRow | null;
};

type DueSpec = {
  kind: 'none' | 'absolute_utc' | 'date' | 'datetime' | 'relative' | 'event';
  absolute_utc: string | null;
  date: string | null;
  datetime_local: string | null;
  relative_value: number | null;
  relative_unit: RelativeUnit | null;
  event_id: string | null;
  offset_minutes: number | null;
};

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

// Austrian university course types. These suffixes distinguish otherwise
// identically-named courses (same code prefix, same subject).
const COURSE_TYPE_RE = /\b(VO|KU|VU|UE|SE|PR|PS|LU|IL|PV|SL|KS)\b/gi;

const TIME_REF_DESCRIPTION =
  'Typed time reference. Use absolute_utc only when copying a CONTEXT anchor verbatim. Use date or datetime for user-local wall-clock times. Use relative for "in 2 hours" / "next week".';

const DUE_DESCRIPTION =
  'Typed due-time spec. Prefer event for reminders tied to a lecture/lab/exam: pass the event_id returned by get_events and offset_minutes (negative for before, positive for after, 0 for exact start). Use date for date-only deadlines, datetime for specific wall-clock times in the user timezone, relative for "in X hours/days", absolute_utc only when copying a CONTEXT anchor exactly, and none to clear/remove the due time.';

const ClarificationRequestSchema = z.object({
  question: z.string().min(1).max(300),
  options: z
    .array(z.object({ label: z.string().min(1).max(200) }))
    .min(2)
    .max(5),
});

const TimeRefSchema = z
  .object({
    kind: z.enum(['absolute_utc', 'date', 'datetime', 'relative']),
    absolute_utc: z.string().datetime().nullable(),
    date: z.string().regex(DATE_RE).nullable(),
    datetime_local: z.string().regex(DATETIME_RE).nullable(),
    relative_value: z.number().int().positive().nullable(),
    relative_unit: z.enum(['minute', 'hour', 'day', 'week']).nullable(),
  })
  .superRefine((ref, ctx) => {
    if (ref.kind === 'absolute_utc' && !ref.absolute_utc) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'absolute_utc is required' });
    }
    if (ref.kind === 'date' && !ref.date) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'date is required' });
    }
    if (ref.kind === 'datetime' && !ref.datetime_local) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'datetime_local is required' });
    }
    if (ref.kind === 'relative' && (!ref.relative_value || !ref.relative_unit)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'relative_value and relative_unit are required',
      });
    }
  });

const DueSpecSchema = z
  .object({
    kind: z.enum(['none', 'absolute_utc', 'date', 'datetime', 'relative', 'event']),
    absolute_utc: z.string().datetime().nullable(),
    date: z.string().regex(DATE_RE).nullable(),
    datetime_local: z.string().regex(DATETIME_RE).nullable(),
    relative_value: z.number().int().positive().nullable(),
    relative_unit: z.enum(['minute', 'hour', 'day', 'week']).nullable(),
    event_id: z.string().uuid().nullable(),
    offset_minutes: z.number().int().nullable(),
  })
  .superRefine((spec, ctx) => {
    if (spec.kind === 'absolute_utc' && !spec.absolute_utc) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'absolute_utc is required' });
    }
    if (spec.kind === 'date' && !spec.date) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'date is required' });
    }
    if (spec.kind === 'datetime' && !spec.datetime_local) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'datetime_local is required' });
    }
    if (spec.kind === 'relative' && (!spec.relative_value || !spec.relative_unit)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'relative_value and relative_unit are required',
      });
    }
    if (spec.kind === 'event' && !spec.event_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'event_id is required' });
    }
  });

function timeRefSchemaJson() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: {
        type: 'string',
        enum: ['absolute_utc', 'date', 'datetime', 'relative'],
        description: TIME_REF_DESCRIPTION,
      },
      absolute_utc: { type: ['string', 'null'], format: 'date-time' },
      date: { type: ['string', 'null'], pattern: DATE_RE.source },
      datetime_local: { type: ['string', 'null'], pattern: DATETIME_RE.source },
      relative_value: { type: ['integer', 'null'], minimum: 1 },
      relative_unit: {
        type: ['string', 'null'],
        enum: ['minute', 'hour', 'day', 'week', null],
      },
    },
    required: ['kind', 'absolute_utc', 'date', 'datetime_local', 'relative_value', 'relative_unit'],
  } as const;
}

function dueSpecSchemaJson() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: {
        type: 'string',
        enum: ['none', 'absolute_utc', 'date', 'datetime', 'relative', 'event'],
        description: DUE_DESCRIPTION,
      },
      absolute_utc: { type: ['string', 'null'], format: 'date-time' },
      date: { type: ['string', 'null'], pattern: DATE_RE.source },
      datetime_local: { type: ['string', 'null'], pattern: DATETIME_RE.source },
      relative_value: { type: ['integer', 'null'], minimum: 1 },
      relative_unit: {
        type: ['string', 'null'],
        enum: ['minute', 'hour', 'day', 'week', null],
      },
      event_id: { type: ['string', 'null'], format: 'uuid' },
      offset_minutes: { type: ['integer', 'null'] },
    },
    required: [
      'kind',
      'absolute_utc',
      'date',
      'datetime_local',
      'relative_value',
      'relative_unit',
      'event_id',
      'offset_minutes',
    ],
  } as const;
}

function strictFunction(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
): AgentTool['definition'] {
  return {
    type: 'function',
    function: {
      name,
      description,
      strict: true,
      parameters,
    },
  };
}

function courseTypes(name: string): string[] {
  const matches = name.match(COURSE_TYPE_RE);
  return matches ? matches.map((m) => m.toUpperCase()) : [];
}

function normalizeCourseText(input: string): string {
  return input
    .toLowerCase()
    .replace(/,\s*standardgruppe\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactCourseText(input: string): string {
  return normalizeCourseText(input).replace(/[^a-z0-9]+/g, '');
}

function courseDisplayLabel(course: CourseRow): string {
  return course.code ? `${course.code} ${course.name}` : course.name;
}

function courseRefScore(course: CourseRow, raw: string): number {
  const rawNorm = normalizeCourseText(raw);
  const rawCompact = compactCourseText(raw);
  const display = courseDisplayLabel(course);
  const displayNorm = normalizeCourseText(display);
  const displayCompact = compactCourseText(display);
  const nameNorm = normalizeCourseText(course.name);
  const codeNorm = normalizeCourseText(course.code ?? '');
  const baseNorm = normalizeBase(course);

  if (rawNorm === displayNorm || rawCompact === displayCompact) return 100;
  if (course.code && (rawNorm === codeNorm || rawCompact === compactCourseText(course.code))) return 95;
  if (rawNorm === nameNorm) return 90;
  if (rawNorm === baseNorm) return 85;
  if (displayNorm.includes(rawNorm)) return 70;

  const rawTokens = rawNorm.split(' ').filter(Boolean);
  if (rawTokens.length > 0 && rawTokens.every((token) => displayNorm.includes(token))) return 60;

  return 0;
}

function normalizeBase(c: CourseRow): string {
  let n = c.name;
  if (c.code) {
    const codeRe = new RegExp(`^\\s*${c.code.replace(/[.\\]/g, (m) => `\\${m}`)}\\s*`);
    n = n.replace(codeRe, '');
  }
  n = n.replace(COURSE_TYPE_RE, ' ');
  n = n.replace(/,\s*Standardgruppe\s*$/i, ' ');
  n = n.replace(/\s+/g, ' ').trim().toLowerCase();
  return n;
}

function findSiblings(all: CourseRow[], target: CourseRow): CourseRow[] {
  const base = normalizeBase(target);
  return all.filter((c) => c.id !== target.id && normalizeBase(c) === base);
}

function userDisambiguatedTarget(
  lastUserMessage: string,
  target: CourseRow,
  siblings: CourseRow[],
): boolean {
  const msg = lastUserMessage.toLowerCase();
  if (!msg) return false;
  if (target.code && msg.includes(target.code.toLowerCase())) return true;
  if (target.code) {
    const numeric = target.code.replace(/\D+/g, '');
    if (numeric.length >= 3 && msg.includes(numeric)) return true;
  }
  const targetTypes = new Set(courseTypes(target.name));
  const siblingTypes = new Set(siblings.flatMap((s) => courseTypes(s.name)));
  for (const t of targetTypes) {
    if (siblingTypes.has(t)) continue;
    const re = new RegExp(`\\b${t.toLowerCase()}\\b`);
    if (re.test(msg)) return true;
  }
  return false;
}

function userDisambiguatedEventSchedule(lastUserMessage: string, event: EventAnchorRow, tz: string): boolean {
  const msg = lastUserMessage.toLowerCase();
  if (!msg) return false;
  const eventDate = new Date(event.start_at);
  const localWallClock = toLocalWallClock(event.start_at, tz);
  const time24 = localWallClock.slice(11, 16);
  const time12 = eventDate
    .toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: tz,
    })
    .toLowerCase()
    .replace(/\s+/g, '');
  const weekdayLong = eventDate.toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: tz,
  }).toLowerCase();
  const weekdayShort = eventDate.toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: tz,
  }).toLowerCase();
  return [time24, time12, weekdayLong, weekdayShort].some((marker) => marker.length > 0 && msg.includes(marker));
}

function buildAmbiguousCourseError(matches: CourseRow[], ref?: string) {
  return {
    error: 'ambiguous_course',
    reason:
      ref && ref.length > 0
        ? `The course reference "${ref}" matches multiple courses the user owns.`
        : 'This course reference matches multiple courses the user owns.',
    matches: matches.map((c) => ({ id: c.id, name: c.name, code: c.code })),
    instruction:
      'Do not pick one. Ask the user to choose explicitly, including code + name + type in each option.',
  };
}

function buildCourseNotFoundError(ref: string) {
  return {
    error: 'course_not_found',
    reason: `No course matching "${ref}" was found for this user.`,
    instruction:
      'Do not guess. Ask the user to name the course more precisely, or omit the course if they want an uncategorized item.',
  };
}

function buildCourseEventMismatchError(
  event: EventAnchorRow,
  requestedCourseRef: string | null | undefined,
) {
  return {
    error: 'course_event_mismatch',
    reason: 'The selected event_id belongs to a different course than the requested course_ref.',
    event: {
      id: event.id,
      title: event.title,
      start_at: event.start_at,
      course_id: event.course_id,
    },
    requested_course_ref: requestedCourseRef ?? null,
    instruction:
      'Do not ask again if the user already chose the course. Call get_events for the chosen course around this event time, then retry the write with the new event_id.',
  };
}

function clarificationSchemaJson() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      question: { type: 'string' },
      options: {
        type: 'array',
        minItems: 2,
        maxItems: 5,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            label: { type: 'string' },
          },
          required: ['label'],
        },
      },
    },
    required: ['question', 'options'],
  } as const;
}

export function buildTools(
  supabase: DB,
  userId: string,
  userTz: string,
  lastUserMessage: string,
): AgentTool[] {
  const decorateEvent = <
    T extends { start_at: string; end_at?: string | null; source_tz?: string | null },
  >(
    event: T,
  ) => decorateEventTimes(event, userTz);
  const decorateTask = <
    T extends {
      due_at: string | null;
      due_kind?: string | null;
      due_tz?: string | null;
      anchor_event_id?: string | null;
      offset_minutes?: number | null;
    },
  >(
    task: T,
  ) => decorateTaskTimes(task, userTz);

  async function listOwnedCourses(): Promise<CourseRow[]> {
    const { data, error } = await supabase
      .from('courses')
      .select('id, name, code')
      .eq('owner_id', userId);
    if (error) throw new Error(error.message);
    return (data ?? []) as CourseRow[];
  }

  async function guardCourseAmbiguity(
    targetId: string,
  ): Promise<{ ok: true } | { ok: false; error: Record<string, unknown> }> {
    const courses = await listOwnedCourses();
    const target = courses.find((c) => c.id === targetId);
    if (!target) return { ok: true };
    const siblings = findSiblings(courses, target);
    if (siblings.length === 0) return { ok: true };
    if (userDisambiguatedTarget(lastUserMessage, target, siblings)) return { ok: true };
    return {
      ok: false,
      error: {
        error: 'ambiguous_course',
        reason: `"${target.name}" shares its base name with ${siblings.length} other course(s) the user owns, and the user's last message did not name a distinguishing marker (code or type like VO/KU/VU/UE).`,
        target: { id: target.id, name: target.name, code: target.code },
        siblings: siblings.map((s) => ({ id: s.id, name: s.name, code: s.code })),
        instruction:
          'Do not retry with this course. Ask the user to pick a specific course, including code + name + type in each option.',
      },
    };
  }

  async function guardEventAmbiguity(
    event: EventAnchorRow,
  ): Promise<{ ok: true } | { ok: false; error: Record<string, unknown> }> {
    if (!event.course_id) return { ok: true };
    const courses = await listOwnedCourses();
    const target = courses.find((course) => course.id === event.course_id);
    if (!target) return { ok: true };
    const siblings = findSiblings(courses, target);
    if (siblings.length === 0) return { ok: true };
    if (userDisambiguatedTarget(lastUserMessage, target, siblings)) return { ok: true };
    if (userDisambiguatedEventSchedule(lastUserMessage, event, userTz)) return { ok: true };
    return {
      ok: false,
      error: {
        error: 'ambiguous_course',
        reason: `"${target.name}" shares its base name with ${siblings.length} other course(s) the user owns, and the user's last message did not identify which scheduled class they meant.`,
        target: { id: target.id, name: target.name, code: target.code, event_id: event.id, event_title: event.title },
        siblings: siblings.map((s) => ({ id: s.id, name: s.name, code: s.code })),
        instruction:
          'Do not retry with this event. Call request_clarification and let the user pick the exact class.',
      },
    };
  }

  async function resolveCourseRef(ref: string | undefined | null): Promise<CourseResolution> {
    const raw = ref?.trim();
    if (!raw) return { kind: 'none' };

    if (UUID_RE.test(raw)) {
      const { data } = await supabase
        .from('courses')
        .select('id, name, code')
        .eq('owner_id', userId)
        .eq('id', raw)
        .maybeSingle();
      return data ? { kind: 'match', course: data as CourseRow } : { kind: 'none' };
    }

    const courses = await listOwnedCourses();
    const scored = courses
      .map((course) => ({ course, score: courseRefScore(course, raw) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) =>
        b.score - a.score || courseDisplayLabel(a.course).localeCompare(courseDisplayLabel(b.course)),
      );
    if (scored.length === 0) return { kind: 'none' };

    const bestScore = scored[0]!.score;
    const matches = scored
      .filter((entry) => entry.score === bestScore)
      .map((entry) => entry.course);
    if (matches.length === 1) return { kind: 'match', course: matches[0]! };
    return { kind: 'ambiguous', matches };
  }

  async function resolveCourseFilter(
    ref: string | undefined | null,
  ): Promise<{ id: string | null } | { error: Record<string, unknown> }> {
    const raw = ref?.trim();
    if (!raw) return { id: null };
    const resolved = await resolveCourseRef(ref);
    if (resolved.kind === 'none') return { error: buildCourseNotFoundError(raw) };
    if (resolved.kind === 'ambiguous') return { error: buildAmbiguousCourseError(resolved.matches, ref ?? undefined) };
    return { id: resolved.course.id };
  }

  async function resolveCourseWrite(
    ref: string | undefined | null,
  ): Promise<{ id: string | null } | { error: Record<string, unknown> }> {
    const raw = ref?.trim();
    if (!raw) return { id: null };
    const resolved = await resolveCourseRef(ref);
    if (resolved.kind === 'none') return { error: buildCourseNotFoundError(raw) };
    if (resolved.kind === 'ambiguous') return { error: buildAmbiguousCourseError(resolved.matches, ref ?? undefined) };
    const guard = await guardCourseAmbiguity(resolved.course.id);
    if (!guard.ok) return { error: guard.error };
    return { id: resolved.course.id };
  }

  async function getEventAnchor(eventId: string): Promise<EventAnchorRow | null> {
    const { data, error } = await supabase
      .from('events')
      .select('id, title, start_at, source_tz, course_id')
      .eq('owner_id', userId)
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ?? null;
  }

  async function resolveDue(
    raw: unknown,
  ): Promise<ResolvedDue> {
    const spec = DueSpecSchema.parse(raw) as DueSpec;
    if (spec.kind === 'none') {
      return {
        due_at: null,
        due_kind: 'none',
        due_tz: null,
        anchor_event_id: null,
        offset_minutes: 0,
        anchorEvent: null,
      };
    }

    if (spec.kind === 'event') {
      const event = await getEventAnchor(spec.event_id!);
      if (!event) throw new Error('event_id not found');
      const offsetMinutes = spec.offset_minutes ?? 0;
      return {
        due_at: new Date(new Date(event.start_at).getTime() + offsetMinutes * 60_000).toISOString(),
        due_kind: 'event',
        due_tz: event.source_tz ?? userTz,
        anchor_event_id: event.id,
        offset_minutes: offsetMinutes,
        anchorEvent: event,
      };
    }

    const baseRef: TimeRefInput =
      spec.kind === 'absolute_utc'
        ? {
            kind: 'absolute_utc',
            absolute_utc: spec.absolute_utc,
            date: null,
            datetime_local: null,
            relative_value: null,
            relative_unit: null,
          }
        : spec.kind === 'date'
          ? {
              kind: 'date',
              absolute_utc: null,
              date: spec.date,
              datetime_local: null,
              relative_value: null,
              relative_unit: null,
            }
          : spec.kind === 'datetime'
            ? {
                kind: 'datetime',
                absolute_utc: null,
                date: null,
                datetime_local: spec.datetime_local,
                relative_value: null,
                relative_unit: null,
              }
            : {
                kind: 'relative',
                absolute_utc: null,
                date: null,
                datetime_local: null,
                relative_value: spec.relative_value,
                relative_unit: spec.relative_unit,
              };

    return {
      due_at: resolveTimeRef(TimeRefSchema.parse(baseRef), userTz),
      due_kind: spec.kind === 'date' ? 'date' : 'datetime',
      due_tz: spec.kind === 'absolute_utc' ? 'UTC' : userTz,
      anchor_event_id: null,
      offset_minutes: 0,
      anchorEvent: null,
    };
  }

  return [
    {
      definition: strictFunction(
        'request_clarification',
        'Ask the user to choose between 2-5 explicit options when a write action is ambiguous. Call this instead of writing prose.',
        clarificationSchemaJson(),
      ),
      handler: async (args) => {
        const request = ClarificationRequestSchema.parse(args);
        const unique = new Set(request.options.map((option) => option.label.trim().toLowerCase()));
        if (unique.size !== request.options.length) {
          throw new Error('clarification options must be unique');
        }
        return { __ask_clarification: request };
      },
    },

    {
      definition: strictFunction(
        'list_tasks',
        "List the user's tasks. Default returns open tasks ordered by due date.",
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: {
              type: ['string', 'null'],
              enum: ['open', 'completed', 'all', null],
              description: 'Completion filter. Use null for the default open view.',
            },
            course_ref: {
              type: ['string', 'null'],
              description: 'Optional course uuid, code, or name fragment.',
            },
            limit: { type: ['integer', 'null'], minimum: 1, maximum: 100 },
          },
          required: ['status', 'course_ref', 'limit'],
        },
      ),
      handler: async (args) => {
        const status = asString(args.status) ?? 'open';
        const course = await resolveCourseFilter(asString(args.course_ref));
        if ('error' in course) return course.error;
        const limit = Math.min(100, asNumber(args.limit, 20));
        let q = supabase
          .from('tasks')
          .select(
            'id, title, description, due_at, due_kind, due_tz, anchor_event_id, offset_minutes, completed_at, course_id',
          )
          .eq('owner_id', userId)
          .order('due_at', { ascending: true, nullsFirst: false })
          .limit(limit);
        if (status === 'open') q = q.is('completed_at', null);
        else if (status === 'completed') q = q.not('completed_at', 'is', null);
        if (course.id) q = q.eq('course_id', course.id);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return (data ?? []).map(decorateTask);
      },
    },

    {
      definition: strictFunction(
        'find_notes',
        'Search notes by keyword (matches title or content).',
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string', description: 'Keyword or phrase to match.' },
            course_ref: {
              type: ['string', 'null'],
              description: 'Optional course uuid, code, or name fragment.',
            },
            limit: { type: ['integer', 'null'], minimum: 1, maximum: 50 },
          },
          required: ['query', 'course_ref', 'limit'],
        },
      ),
      handler: async (args) => {
        const query = asString(args.query) ?? '';
        const course = await resolveCourseFilter(asString(args.course_ref));
        if ('error' in course) return course.error;
        const limit = Math.min(50, asNumber(args.limit, 10));
        let q = supabase
          .from('notes')
          .select('id, title, content, course_id, created_at')
          .eq('owner_id', userId)
          .order('created_at', { ascending: false })
          .limit(limit);
        if (query) q = q.or(`title.ilike.%${query}%,content.ilike.%${query}%`);
        if (course.id) q = q.eq('course_id', course.id);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data ?? [];
      },
    },

    {
      definition: strictFunction(
        'list_courses',
        "List the user's courses.",
        {
          type: 'object',
          additionalProperties: false,
          properties: {},
          required: [],
        },
      ),
      handler: async () => {
        const { data, error } = await supabase
          .from('courses')
          .select('id, name, code, color, schedule_text')
          .eq('owner_id', userId)
          .order('created_at');
        if (error) throw new Error(error.message);
        return data ?? [];
      },
    },

    {
      definition: strictFunction(
        'get_events',
        'Get calendar events in a time range.',
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            from: timeRefSchemaJson(),
            to: timeRefSchemaJson(),
            course_ref: {
              type: ['string', 'null'],
              description: 'Optional course uuid, code, or name fragment.',
            },
            limit: { type: ['integer', 'null'], minimum: 1, maximum: 200 },
          },
          required: ['from', 'to', 'course_ref', 'limit'],
        },
      ),
      handler: async (args) => {
        const baseNow = new Date();
        const from = resolveTimeRef(TimeRefSchema.parse(args.from), userTz, baseNow);
        const to = resolveTimeRef(TimeRefSchema.parse(args.to), userTz, baseNow);
        if (new Date(from).getTime() > new Date(to).getTime()) {
          return {
            error: 'invalid_time_range',
            reason: '`from` must be earlier than or equal to `to`.',
          };
        }
        const course = await resolveCourseFilter(asString(args.course_ref));
        if ('error' in course) return course.error;
        const limit = Math.min(200, asNumber(args.limit, 50));
        let q = supabase
          .from('events')
          .select('id, title, location, start_at, end_at, all_day, course_id, source_tz')
          .eq('owner_id', userId)
          .gte('start_at', from)
          .lte('start_at', to)
          .order('start_at')
          .limit(limit);
        if (course.id) q = q.eq('course_id', course.id);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return (data ?? []).map(decorateEvent);
      },
    },

    {
      definition: strictFunction(
        'what_am_i_in_now',
        'Return the event the user is currently in (if any) plus the next event within 2 hours.',
        {
          type: 'object',
          additionalProperties: false,
          properties: {},
          required: [],
        },
      ),
      handler: async () => {
        const now = new Date().toISOString();
        const in2h = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
        const [{ data: current }, { data: next }] = await Promise.all([
          supabase
            .from('events')
            .select('id, title, location, start_at, end_at, course_id, source_tz')
            .eq('owner_id', userId)
            .lte('start_at', now)
            .gte('end_at', now)
            .limit(1),
          supabase
            .from('events')
            .select('id, title, location, start_at, end_at, course_id, source_tz')
            .eq('owner_id', userId)
            .gt('start_at', now)
            .lte('start_at', in2h)
            .order('start_at')
            .limit(1),
        ]);
        return {
          current: current?.[0] ? decorateEvent(current[0]) : null,
          next: next?.[0] ? decorateEvent(next[0]) : null,
        };
      },
    },

    {
      definition: strictFunction(
        'create_task',
        'Create a new task. If the user clearly asked for it, execute directly; otherwise ask first.',
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            description: { type: ['string', 'null'] },
            due: dueSpecSchemaJson(),
            course_ref: {
              type: ['string', 'null'],
              description: 'Optional course uuid, code, or name fragment.',
            },
          },
          required: ['title', 'description', 'due', 'course_ref'],
        },
      ),
      handler: async (args) => {
        const title = asString(args.title);
        if (!title) throw new Error('title is required');
        const requestedCourseRef = asString(args.course_ref);
        const course = await resolveCourseWrite(requestedCourseRef);
        if ('error' in course) return course.error;
        const due = await resolveDue(args.due);
        let courseId = course.id;
        if (due.anchorEvent?.course_id) {
          if (courseId && courseId !== due.anchorEvent.course_id) {
            return buildCourseEventMismatchError(due.anchorEvent, requestedCourseRef);
          }
          const guard = await guardEventAmbiguity(due.anchorEvent);
          if (!guard.ok) return guard.error;
          courseId = due.anchorEvent.course_id;
        }
        const { data, error } = await supabase
          .from('tasks')
          .insert({
            owner_id: userId,
            title,
            description: asString(args.description) ?? null,
            course_id: courseId,
            due_at: due.due_at,
            due_kind: due.due_kind,
            due_tz: due.due_tz,
            anchor_event_id: due.anchor_event_id,
            offset_minutes: due.offset_minutes,
          })
          .select()
          .single();
        if (error) throw new Error(error.message);
        return decorateTask(data);
      },
    },

    {
      definition: strictFunction(
        'update_task',
        'Update fields on an existing task. Use the set_* flags to declare which fields should change.',
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', format: 'uuid' },
            set_title: { type: 'boolean' },
            title: { type: ['string', 'null'] },
            set_description: { type: 'boolean' },
            description: { type: ['string', 'null'] },
            set_due: { type: 'boolean' },
            due: dueSpecSchemaJson(),
            set_course: { type: 'boolean' },
            course_ref: {
              type: ['string', 'null'],
              description: 'Course uuid, code, or name fragment. Use null to clear the course when set_course is true.',
            },
          },
          required: [
            'id',
            'set_title',
            'title',
            'set_description',
            'description',
            'set_due',
            'due',
            'set_course',
            'course_ref',
          ],
        },
      ),
      handler: async (args) => {
        const id = asString(args.id);
        if (!id) throw new Error('id is required');
        const patch: TaskUpdate = {};
        let eventCourseId: string | null | undefined;
        let eventAnchor: EventAnchorRow | null = null;
        const requestedCourseRef = asString(args.course_ref);
        if (asBool(args.set_title)) {
          const title = asString(args.title);
          if (!title) throw new Error('title is required when set_title is true');
          patch.title = title;
        }
        if (asBool(args.set_description)) {
          patch.description = asString(args.description) ?? null;
        }
        if (asBool(args.set_due)) {
          if (args.due == null) throw new Error('due is required when set_due is true');
          const due = await resolveDue(args.due);
          Object.assign(patch, {
            due_at: due.due_at,
            due_kind: due.due_kind,
            due_tz: due.due_tz,
            anchor_event_id: due.anchor_event_id,
            offset_minutes: due.offset_minutes,
          });
          eventAnchor = due.anchorEvent;
          eventCourseId = due.anchorEvent?.course_id ?? null;
          if (due.anchorEvent) {
            if (requestedCourseRef) {
              const requestedCourse = await resolveCourseWrite(requestedCourseRef);
              if ('error' in requestedCourse) return requestedCourse.error;
              if (requestedCourse.id && requestedCourse.id !== due.anchorEvent.course_id) {
                return buildCourseEventMismatchError(due.anchorEvent, requestedCourseRef);
              }
            }
            const guard = await guardEventAmbiguity(due.anchorEvent);
            if (!guard.ok) return guard.error;
          }
        }
        if (asBool(args.set_course)) {
          const course = await resolveCourseWrite(requestedCourseRef);
          if ('error' in course) return course.error;
          if (eventAnchor && course.id && course.id !== eventCourseId) {
            return buildCourseEventMismatchError(eventAnchor, requestedCourseRef);
          }
          patch.course_id = course.id;
        } else if (eventCourseId) {
          patch.course_id = eventCourseId;
        }
        const { data, error } = await supabase
          .from('tasks')
          .update(patch)
          .eq('owner_id', userId)
          .eq('id', id)
          .select()
          .single();
        if (error) throw new Error(error.message);
        return decorateTask(data);
      },
    },

    {
      definition: strictFunction(
        'complete_task',
        'Mark a task complete or uncomplete it.',
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', format: 'uuid' },
            completed: { type: ['boolean', 'null'], description: 'Use null for the default true.' },
          },
          required: ['id', 'completed'],
        },
      ),
      handler: async (args) => {
        const id = asString(args.id);
        if (!id) throw new Error('id is required');
        const completed = asBool(args.completed) ?? true;
        const { data, error } = await supabase
          .from('tasks')
          .update({ completed_at: completed ? new Date().toISOString() : null })
          .eq('owner_id', userId)
          .eq('id', id)
          .select()
          .single();
        if (error) throw new Error(error.message);
        return decorateTask(data);
      },
    },

    {
      definition: strictFunction(
        'create_note',
        'Create a new note. Title is optional; content is required.',
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: ['string', 'null'] },
            content: { type: 'string' },
            course_ref: {
              type: ['string', 'null'],
              description: 'Optional course uuid, code, or name fragment.',
            },
          },
          required: ['title', 'content', 'course_ref'],
        },
      ),
      handler: async (args) => {
        const content = asString(args.content);
        if (!content) throw new Error('content is required');
        const course = await resolveCourseWrite(asString(args.course_ref));
        if ('error' in course) return course.error;
        const { data, error } = await supabase
          .from('notes')
          .insert({
            owner_id: userId,
            title: asString(args.title) ?? null,
            content,
            course_id: course.id,
          })
          .select()
          .single();
        if (error) throw new Error(error.message);
        return data;
      },
    },

    {
      definition: strictFunction(
        'update_note',
        'Update an existing note. Use the set_* flags to declare which fields should change.',
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', format: 'uuid' },
            set_title: { type: 'boolean' },
            title: { type: ['string', 'null'] },
            set_content: { type: 'boolean' },
            content: { type: ['string', 'null'] },
            set_course: { type: 'boolean' },
            course_ref: {
              type: ['string', 'null'],
              description: 'Course uuid, code, or name fragment. Use null to clear the course when set_course is true.',
            },
          },
          required: ['id', 'set_title', 'title', 'set_content', 'content', 'set_course', 'course_ref'],
        },
      ),
      handler: async (args) => {
        const id = asString(args.id);
        if (!id) throw new Error('id is required');
        const patch: NoteUpdate = {};
        if (asBool(args.set_title)) patch.title = asString(args.title) ?? null;
        if (asBool(args.set_content)) {
          const content = asString(args.content);
          if (!content) throw new Error('content is required when set_content is true');
          patch.content = content;
        }
        if (asBool(args.set_course)) {
          const course = await resolveCourseWrite(asString(args.course_ref));
          if ('error' in course) return course.error;
          patch.course_id = course.id;
        }
        const { data, error } = await supabase
          .from('notes')
          .update(patch)
          .eq('owner_id', userId)
          .eq('id', id)
          .select()
          .single();
        if (error) throw new Error(error.message);
        return data;
      },
    },

    {
      definition: strictFunction(
        'create_course',
        'Create a new course. Only use when the user explicitly asks to add a course.',
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            code: { type: ['string', 'null'] },
            color: { type: ['string', 'null'], description: 'Hex color like #6366f1.' },
          },
          required: ['name', 'code', 'color'],
        },
      ),
      handler: async (args) => {
        const name = asString(args.name);
        if (!name) throw new Error('name is required');
        const { data, error } = await supabase
          .from('courses')
          .insert({
            owner_id: userId,
            name,
            code: asString(args.code) ?? null,
            color: asString(args.color) ?? null,
          })
          .select()
          .single();
        if (error) throw new Error(error.message);
        return data;
      },
    },
  ];
}
