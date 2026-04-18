import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@teddy/supabase';
import type { AgentTool } from '@teddy/ai';

type DB = SupabaseClient<Database>;
type TaskUpdate = Database['public']['Tables']['tasks']['Update'];
type NoteUpdate = Database['public']['Tables']['notes']['Update'];

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function asBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

export function buildTools(supabase: DB, userId: string): AgentTool[] {
  // Verify a course id belongs to this user before writing — guards against
  // the model inventing uuids.
  async function assertCourse(courseId: string | undefined): Promise<string | null> {
    if (!courseId) return null;
    const { data } = await supabase
      .from('courses')
      .select('id')
      .eq('owner_id', userId)
      .eq('id', courseId)
      .maybeSingle();
    return data?.id ?? null;
  }

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
        const courseId = asString(args.course_id);
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
        return data ?? [];
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
        const courseId = asString(args.course_id);
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
              from: { type: 'string', description: 'ISO 8601 UTC start.' },
              to: { type: 'string', description: 'ISO 8601 UTC end.' },
              course_id: { type: 'string' },
              limit: { type: 'integer' },
            },
            required: ['from', 'to'],
          },
        },
      },
      handler: async (args) => {
        const from = asString(args.from);
        const to = asString(args.to);
        if (!from || !to) throw new Error('from and to are required');
        const courseId = asString(args.course_id);
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
        return data ?? [];
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
          current: current?.[0] ?? null,
          next: next?.[0] ?? null,
        };
      },
    },

    {
      definition: {
        type: 'function',
        function: {
          name: 'create_task',
          description:
            'Create a new task. due_at is ISO 8601 UTC or null. Confirm with user before calling unless they clearly directed the action.',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              due_at: { type: 'string', description: 'ISO 8601 UTC' },
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
        const { data, error } = await supabase
          .from('tasks')
          .insert({
            owner_id: userId,
            title,
            description: asString(args.description) ?? null,
            due_at: asString(args.due_at) ?? null,
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
          name: 'update_task',
          description:
            'Update fields on an existing task. Always confirm with the user first.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string' },
              due_at: { type: 'string' },
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
        if ('due_at' in args) patch.due_at = asString(args.due_at) ?? null;
        if ('course_id' in args) patch.course_id = await assertCourse(asString(args.course_id));
        const { data, error } = await supabase
          .from('tasks')
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
        return data;
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
        if ('course_id' in args) patch.course_id = await assertCourse(asString(args.course_id));
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
