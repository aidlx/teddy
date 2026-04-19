import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOpenAI, runAgent, type AgentEvent } from '@teddy/ai';
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionToolMessageParam,
  ChatCompletionUserMessageParam,
} from 'openai/resources/chat/completions';
import type { Json } from '@teddy/supabase';
import { getServerSupabase } from '@/lib/supabase/server';
import { buildTools } from '@/lib/assistant/tools';
import { SYSTEM_PROMPT, buildContext } from '@/lib/assistant/context';
import {
  buildClarificationMessage,
  canonicalClarificationReply,
  findPendingClarification,
  parseClarificationAsk,
  resolveClarificationReply,
} from '@/lib/assistant/clarify';
import { rememberUserTz, resolveUserTz } from '@/lib/assistant/time';

export const runtime = 'nodejs';

const MODEL = process.env.OPENAI_ASSISTANT_MODEL ?? 'gpt-4o-mini';

const RequestSchema = z.object({
  conversation_id: z.string().uuid().nullable().optional(),
  message: z.string().min(1).max(40_000),
  // Data-URL-encoded images the user attached. Pass-through to the model as
  // vision parts; not persisted in message history (they'd bloat the DB, and
  // the assistant's textual response captures the salient interpretation).
  images: z.array(z.string().startsWith('data:image/')).max(6).optional(),
  // Browser-reported IANA tz. Validated server-side; invalid/missing falls
  // back to the user's calendar subscription tz, else UTC.
  tz: z.string().max(64).optional(),
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
  let pendingAsk = null as ReturnType<typeof parseClarificationAsk>;
  for (const r of rows) {
    if (r.role === 'system') continue; // system is rebuilt each request
    if (r.role === 'user') {
      const content =
        pendingAsk && r.content
          ? canonicalClarificationReply(r.content, pendingAsk)
          : (r.content ?? '');
      out.push({ role: 'user', content });
      pendingAsk = null;
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
      pendingAsk = parseClarificationAsk(r.content);
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
  const pendingAsk = findPendingClarification((priorRows ?? []) as DbMessageRow[]);
  const clarification = pendingAsk
    ? resolveClarificationReply(parsed.data.message, pendingAsk)
    : { kind: 'unknown', raw: parsed.data.message as string };
  const effectiveMessage =
    clarification.kind === 'unknown'
      ? parsed.data.message
      : canonicalClarificationReply(parsed.data.message, pendingAsk);

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

  await rememberUserTz(supabase, user.id, parsed.data.tz);
  const userTz = await resolveUserTz(supabase, user.id, parsed.data.tz);
  const context = await buildContext(supabase, user.id, userTz);
  const systemPrompt = `${SYSTEM_PROMPT}\n\n${context}`;
  const tools = buildTools(supabase, user.id, userTz, effectiveMessage);

  // If the user attached images, wrap the message + images in a multipart
  // user content array (gpt-4o-mini supports vision). Otherwise plain string.
  const imageUrls = parsed.data.images ?? [];
  const userContent: ChatCompletionUserMessageParam['content'] =
    imageUrls.length > 0
      ? ([
          { type: 'text', text: effectiveMessage },
          ...imageUrls.map(
            (url) =>
              ({ type: 'image_url', image_url: { url } }) satisfies ChatCompletionContentPart,
          ),
        ] satisfies ChatCompletionContentPart[])
      : effectiveMessage;

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
          userMessage: userContent,
          tools,
          maxIterations: 8,
          onEvent: async (ev: AgentEvent) => {
            if (ev.type === 'assistant_delta') {
              send({ type: 'assistant_delta', content_delta: ev.content_delta });
            } else if (ev.type === 'tool_call_start') {
              send({
                type: 'tool_call_start',
                tool_call_id: ev.tool_call_id,
                name: ev.name,
              });
            } else if (ev.type === 'assistant_message') {
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
            } else if (ev.type === 'clarification_requested') {
              const askContent = buildClarificationMessage({
                question: ev.question,
                options: ev.options,
              });
              const { data: row } = await supabase
                .from('messages')
                .insert({
                  conversation_id: convId,
                  owner_id: user.id,
                  role: 'assistant',
                  content: askContent,
                  tool_calls: null,
                })
                .select('id, created_at')
                .single();
              send({
                type: 'assistant_message',
                id: row?.id,
                created_at: row?.created_at,
                content: askContent,
                tool_calls: null,
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
