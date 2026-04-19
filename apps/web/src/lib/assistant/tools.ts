import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@teddy/supabase';
import type { AgentTool } from '@teddy/ai';
import { resolveTime, decorateEventTimes, decorateTaskTimes } from './time';

type DB = SupabaseClient<Database>;
type TaskUpdate = Database['public']['Tables']['tasks']['Update'];
type NoteUpdate = Database['public']['Tables']['notes']['Update'];
type CourseRow = Pick<Database['public']['Tables']['courses']['Row'], 'id' | 'name' | 'code'>;

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

// Austrian university course types. These suffixes distinguish otherwise
// identically-named courses (same code prefix, same subject).
const COURSE_TYPE_RE = /\b(VO|KU|VU|UE|SE|PR|PS|LU|IL|PV|SL|KS)\b/gi;

const TIME_HINT =
  'Accepts: "2026-04-22T14:00" (local wall-clock, PREFERRED — match what the user said), "2026-04-22" (local midnight), "+2h"/"-30m"/"+3d"/"+1w" (relative to now), or absolute ISO ("…Z" / "…+02:00"). Server resolves in the user\'s tz — do not do timezone math. For reminders tied to an event, copy the event\'s `start_local` field verbatim (NOT `start_at`, which is UTC).';

function courseTypes(name: string): string[] {
  const matches = name.match(COURSE_TYPE_RE);
  return matches ? matches.map((m) => m.toUpperCase()) : [];
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

// Given the target course the model wants to act on, return every other course
// the user owns whose "base name" (stripped of code + type suffix like VO/KU)
// matches. Empty array = unambiguous; non-empty = the model must have been
// explicit to proceed.
function findSiblings(all: CourseRow[], target: CourseRow): CourseRow[] {
  const base = normalizeBase(target);
  return all.filter((c) => c.id !== target.id && normalizeBase(c) === base);
}

// Did the user's last message mention a token that picks `target` uniquely
// out of its siblings? We look for the course code (e.g. "721.010") or a
// type marker ("KU", "VO") that target has and the siblings do not.
function userDisambiguatedTarget(
  lastUserMessage: string,
  target: CourseRow,
  siblings: CourseRow[],
): boolean {
  const msg = lastUserMessage.toLowerCase();
  if (!msg) return false;
  if (target.code && msg.includes(target.code.toLowerCase())) return true;
  // Some users type just the numeric code: "716" for "716.009".
  if (target.code) {
    const numeric = target.code.replace(/\D+/g, '');
    if (numeric.length >= 3 && msg.includes(numeric)) return true;
  }
  const targetTypes = new Set(courseTypes(target.name));
  const siblingTypes = new Set(siblings.flatMap((s) => courseTypes(s.name)));
  for (const t of targetTypes) {
    if (siblingTypes.has(t)) continue;
    // Word-boundary match to avoid "vu" hitting "vue" etc.
    const re = new RegExp(`\\b${t.toLowerCase()}\\b`);
    if (re.test(msg)) return true;
  }
  return false;
}

export function buildTools(
  supabase: DB,
  userId: string,
  userTz: string,
  lastUserMessage: string,
): AgentTool[] {
  const decorateEvent = <T extends { start_at: string; end_at?: string | null }>(e: T) =>
    decorateEventTimes(e, userTz);
  const decorateTask = <T extends { due_at: string | null }>(t: T) =>
    decorateTaskTimes(t, userTz);

  async function guardCourseAmbiguity(
    targetId: string,
  ): Promise<{ ok: true } | { ok: false; error: Record<string, unknown> }> {
    const { data: all } = await supabase
      .from('courses')
      .select('id, name, code')
      .eq('owner_id', userId);
    const courses = (all ?? []) as CourseRow[];
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
          'Do NOT retry with this course_id. First ask the user to pick: emit ONLY a ```ask``` fence with all candidates as options (include code + name + type, e.g. "721.009 Theoretical Computer Science VO"). After the user picks, call the write tool again using the course_id they chose.',
      },
    };
  }
  const resolve = (s: string | undefined) => (s ? resolveTime(s, userTz) : undefined);
  // Resolve a user-supplied course reference to a uuid. Accepts either a
  // proper uuid (verified to belong to this user) or a course code / name
  // fragment (case-insensitive match) — the model sometimes passes the code
  // by mistake. Returns null if nothing matches.
  async function resolveCourse(ref: string | undefined): Promise<string | null> {
    if (!ref) return null;
    if (UUID_RE.test(ref)) {
      const { data } = await supabase
        .from('courses')
        .select('id')
        .eq('owner_id', userId)
        .eq('id', ref)
        .maybeSingle();
      return data?.id ?? null;
    }
    const { data } = await supabase
      .from('courses')
      .select('id')
      .eq('owner_id', userId)
      .or(`code.ilike.%${ref}%,name.ilike.%${ref}%`)
      .limit(1)
      .maybeSingle();
    return data?.id ?? null;
  }
  const assertCourse = resolveCourse;

  return [
    {
      definition: {
        type: 'function',
        function: {
          name: 'list_tasks',
          description:
            "List the user's tasks. Default returns open tasks ordered by due date.",
          parameters: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['open', 'completed', 'all'],
                description: 'Filter by completion state. Default: open.',
              },
              course_id: { type: 'string', description: 'Optional course id to filter by.' },
              limit: { type: 'integer', description: 'Max rows. Default 20.' },
            },
          },
        },
      },
      handler: async (args) => {
        const status = asString(args.status) ?? 'open';
        const courseId = await resolveCourse(asString(args.course_id));
        const limit = Math.min(100, asNumber(args.limit, 20));
        let q = supabase
          .from('tasks')
          .select('id, title, description, due_at, completed_at, course_id')
          .eq('owner_id', userId)
          .order('due_at', { ascending: true, nullsFirst: false })
          .limit(limit);
        if (status === 'open') q = q.is('completed_at', null);
        else if (status === 'completed') q = q.not('completed_at', 'is', null);
        if (courseId) q = q.eq('course_id', courseId);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return (data ?? []).map(decorateTask);
      },
    },

    {
      definition: {
        type: 'function',
        function: {
          name: 'find_notes',
          description: 'Search notes by keyword (matches title or content).',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Keyword or phrase to match.' },
              course_id: { type: 'string' },
              limit: { type: 'integer' },
            },
            required: ['query'],
          },
        },
      },
      handler: async (args) => {
        const query = asString(args.query) ?? '';
        const courseId = await resolveCourse(asString(args.course_id));
        const limit = Math.min(50, asNumber(args.limit, 10));
        let q = supabase
          .from('notes')
          .select('id, title, content, course_id, created_at')
          .eq('owner_id', userId)
          .order('created_at', { ascending: false })
          .limit(limit);
        if (query) q = q.or(`title.ilike.%${query}%,content.ilike.%${query}%`);
        if (courseId) q = q.eq('course_id', courseId);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data ?? [];
      },
    },

    {
      definition: {
        type: 'function',
        function: {
          name: 'list_courses',
          description: "List the user's courses.",
          parameters: { type: 'object', properties: {} },
        },
      },
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
      definition: {
        type: 'function',
        function: {
          name: 'get_events',
          description: 'Get calendar events in a time range.',
          parameters: {
            type: 'object',
            properties: {
              from: { type: 'string', description: `Range start. ${TIME_HINT}` },
              to: { type: 'string', description: `Range end. ${TIME_HINT}` },
              course_id: { type: 'string' },
              limit: { type: 'integer' },
            },
            required: ['from', 'to'],
          },
        },
      },
      handler: async (args) => {
        const from = resolve(asString(args.from));
        const to = resolve(asString(args.to));
        if (!from || !to) throw new Error('from and to are required');
        const courseId = await resolveCourse(asString(args.course_id));
        const limit = Math.min(200, asNumber(args.limit, 50));
        let q = supabase
          .from('events')
          .select('id, title, location, start_at, end_at, all_day, course_id')
          .eq('owner_id', userId)
          .gte('start_at', from)
          .lte('start_at', to)
          .order('start_at')
          .limit(limit);
        if (courseId) q = q.eq('course_id', courseId);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return (data ?? []).map(decorateEvent);
      },
    },

    {
      definition: {
        type: 'function',
        function: {
          name: 'what_am_i_in_now',
          description:
            'Return the event the user is currently in (if any) plus the next event within 2 hours.',
          parameters: { type: 'object', properties: {} },
        },
      },
      handler: async () => {
        const now = new Date().toISOString();
        const in2h = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
        const [{ data: current }, { data: next }] = await Promise.all([
          supabase
            .from('events')
            .select('id, title, location, start_at, end_at, course_id')
            .eq('owner_id', userId)
            .lte('start_at', now)
            .gte('end_at', now)
            .limit(1),
          supabase
            .from('events')
            .select('id, title, location, start_at, end_at, course_id')
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
      definition: {
        type: 'function',
        function: {
          name: 'create_task',
          description:
            'Create a new task. Confirm with user before calling unless they clearly directed the action.',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              due_at: { type: 'string', description: TIME_HINT },
              course_id: { type: 'string' },
            },
            required: ['title'],
          },
        },
      },
      handler: async (args) => {
        const title = asString(args.title);
        if (!title) throw new Error('title is required');
        const courseId = await assertCourse(asString(args.course_id));
        if (courseId) {
          const guard = await guardCourseAmbiguity(courseId);
          if (!guard.ok) return guard.error;
        }
        const { data, error } = await supabase
          .from('tasks')
          .insert({
            owner_id: userId,
            title,
            description: asString(args.description) ?? null,
            due_at: resolve(asString(args.due_at)) ?? null,
            course_id: courseId,
          })
          .select()
          .single();
        if (error) throw new Error(error.message);
        return decorateTask(data);
      },
    },

    {
      definition: {
        type: 'function',
        function: {
          name: 'update_task',
          description:
            'Update fields on an existing task. Always confirm with the user first.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string' },
              due_at: { type: 'string', description: TIME_HINT },
              course_id: { type: 'string' },
            },
            required: ['id'],
          },
        },
      },
      handler: async (args) => {
        const id = asString(args.id);
        if (!id) throw new Error('id is required');
        const patch: TaskUpdate = {};
        if ('title' in args) {
          const v = asString(args.title);
          if (v) patch.title = v;
        }
        if ('description' in args) patch.description = asString(args.description) ?? null;
        if ('due_at' in args) patch.due_at = resolve(asString(args.due_at)) ?? null;
        if ('course_id' in args) {
          const newCourseId = await assertCourse(asString(args.course_id));
          if (newCourseId) {
            const guard = await guardCourseAmbiguity(newCourseId);
            if (!guard.ok) return guard.error;
          }
          patch.course_id = newCourseId;
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
      definition: {
        type: 'function',
        function: {
          name: 'complete_task',
          description: 'Mark a task complete or uncomplete it.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              completed: { type: 'boolean', description: 'Default true.' },
            },
            required: ['id'],
          },
        },
      },
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
      definition: {
        type: 'function',
        function: {
          name: 'create_note',
          description:
            'Create a new note. Title is optional; content is required.',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              content: { type: 'string' },
              course_id: { type: 'string' },
            },
            required: ['content'],
          },
        },
      },
      handler: async (args) => {
        const content = asString(args.content);
        if (!content) throw new Error('content is required');
        const courseId = await assertCourse(asString(args.course_id));
        if (courseId) {
          const guard = await guardCourseAmbiguity(courseId);
          if (!guard.ok) return guard.error;
        }
        const { data, error } = await supabase
          .from('notes')
          .insert({
            owner_id: userId,
            title: asString(args.title) ?? null,
            content,
            course_id: courseId,
          })
          .select()
          .single();
        if (error) throw new Error(error.message);
        return data;
      },
    },

    {
      definition: {
        type: 'function',
        function: {
          name: 'update_note',
          description: 'Update an existing note.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              content: { type: 'string' },
              course_id: { type: 'string' },
            },
            required: ['id'],
          },
        },
      },
      handler: async (args) => {
        const id = asString(args.id);
        if (!id) throw new Error('id is required');
        const patch: NoteUpdate = {};
        if ('title' in args) patch.title = asString(args.title) ?? null;
        if ('content' in args) {
          const v = asString(args.content);
          if (v) patch.content = v;
        }
        if ('course_id' in args) {
          const newCourseId = await assertCourse(asString(args.course_id));
          if (newCourseId) {
            const guard = await guardCourseAmbiguity(newCourseId);
            if (!guard.ok) return guard.error;
          }
          patch.course_id = newCourseId;
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
      definition: {
        type: 'function',
        function: {
          name: 'create_course',
          description:
            'Create a new course. Only use when the user explicitly asks to add a course.',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              code: { type: 'string' },
              color: { type: 'string', description: 'Hex color like #6366f1.' },
            },
            required: ['name'],
          },
        },
      },
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
