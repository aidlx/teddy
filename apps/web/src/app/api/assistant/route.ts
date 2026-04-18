import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOpenAI, runAgent, type AgentEvent } from '@teddy/ai';
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions';
import type { Json } from '@teddy/supabase';
import { getServerSupabase } from '@/lib/supabase/server';
import { buildTools } from '@/lib/assistant/tools';
import { SYSTEM_PROMPT, buildContext } from '@/lib/assistant/context';

export const runtime = 'nodejs';

const MODEL = 'gpt-4o-mini';

const RequestSchema = z.object({
  conversation_id: z.string().uuid().nullable().optional(),
  message: z.string().min(1).max(4000),
});

interface DbMessageRow {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls: unknown;
  tool_call_id: string | null;
  name: string | null;
}

function toOpenAIHistory(rows: DbMessageRow[]): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [];
  for (const r of rows) {
    if (r.role === 'system') continue; // system is rebuilt each request
    if (r.role === 'user') {
      out.push({ role: 'user', content: r.content ?? '' });
    } else if (r.role === 'assistant') {
      const tc = Array.isArray(r.tool_calls)
        ? (r.tool_calls as ChatCompletionMessageToolCall[])
        : null;
      const msg: ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: r.content ?? null,
      };
      if (tc && tc.length > 0) msg.tool_calls = tc;
      out.push(msg);
    } else if (r.role === 'tool') {
      const msg: ChatCompletionToolMessageParam = {
        role: 'tool',
        tool_call_id: r.tool_call_id ?? '',
        content: r.content ?? '',
      };
      out.push(msg);
    }
  }
  return out;
}

export async function POST(request: NextRequest) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const parsed = RequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(parsed.error.message, { status: 400 });
  }

  // Resolve or create the conversation.
  let conversationId = parsed.data.conversation_id ?? undefined;
  if (!conversationId) {
    const { data, error } = await supabase
      .from('conversations')
      .insert({
        owner_id: user.id,
        title: parsed.data.message.slice(0, 60),
      })
      .select('id')
      .single();
    if (error) return new Response(error.message, { status: 500 });
    conversationId = data.id;
  }

  // Load prior messages.
  const { data: priorRows, error: priorErr } = await supabase
    .from('messages')
    .select('role, content, tool_calls, tool_call_id, name')
    .eq('conversation_id', conversationId)
    .order('created_at');
  if (priorErr) return new Response(priorErr.message, { status: 500 });

  const history = toOpenAIHistory((priorRows ?? []) as DbMessageRow[]);

  // Persist the user's new message.
  const { data: userMsg, error: userMsgErr } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      owner_id: user.id,
      role: 'user',
      content: parsed.data.message,
    })
    .select('id, created_at')
    .single();
  if (userMsgErr) return new Response(userMsgErr.message, { status: 500 });

  const context = await buildContext(supabase, user.id);
  const systemPrompt = `${SYSTEM_PROMPT}\n\n${context}`;
  const tools = buildTools(supabase, user.id);

  const encoder = new TextEncoder();
  const convId = conversationId;

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      send({
        type: 'meta',
        conversation_id: convId,
        user_message_id: userMsg.id,
        user_message_created_at: userMsg.created_at,
      });

      try {
        await runAgent({
          openai: getOpenAI(),
          model: MODEL,
          systemPrompt,
          history,
          userMessage: parsed.data.message,
          tools,
          maxIterations: 8,
          onEvent: async (ev: AgentEvent) => {
            if (ev.type === 'assistant_message') {
              const { data: row } = await supabase
                .from('messages')
                .insert({
                  conversation_id: convId,
                  owner_id: user.id,
                  role: 'assistant',
                  content: ev.content,
                  tool_calls: (ev.tool_calls ?? null) as unknown as Json,
                })
                .select('id, created_at')
                .single();
              send({
                type: 'assistant_message',
                id: row?.id,
                created_at: row?.created_at,
                content: ev.content,
                tool_calls: ev.tool_calls,
              });
            } else if (ev.type === 'tool_result') {
              const { data: row } = await supabase
                .from('messages')
                .insert({
                  conversation_id: convId,
                  owner_id: user.id,
                  role: 'tool',
                  content: ev.content,
                  tool_call_id: ev.tool_call_id,
                  name: ev.name,
                })
                .select('id, created_at')
                .single();
              send({
                type: 'tool_result',
                id: row?.id,
                created_at: row?.created_at,
                tool_call_id: ev.tool_call_id,
                name: ev.name,
                content: ev.content,
              });
            } else if (ev.type === 'done') {
              send({ type: 'done' });
            } else if (ev.type === 'error') {
              send({ type: 'error', message: ev.message });
            }
          },
        });

        await supabase
          .from('conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', convId);
      } catch (err) {
        send({ type: 'error', message: (err as Error).message ?? 'Agent failed' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
