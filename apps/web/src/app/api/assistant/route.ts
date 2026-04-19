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
import {
  PendingActionSchema,
  applyPendingOption,
  type PendingAction,
} from '@/lib/assistant/pending';
import { rememberUserTz, resolveUserTz } from '@/lib/assistant/time';

export const runtime = 'nodejs';

const MODEL = process.env.OPENAI_ASSISTANT_MODEL ?? 'gpt-4o-mini';

const RequestSchema = z.object({
  conversation_id: z.string().uuid().nullable().optional(),
  message: z.string().min(1).max(40_000),
  images: z.array(z.string().startsWith('data:image/')).max(6).optional(),
  tz: z.string().max(64).optional(),
});

interface DbMessageRow {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls: unknown;
  tool_call_id: string | null;
  name: string | null;
}

interface ConversationRow {
  id: string;
  pending_action: Json | null;
}

function toOpenAIHistory(rows: DbMessageRow[]): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [];
  let pendingAsk = null as ReturnType<typeof parseClarificationAsk>;
  for (const r of rows) {
    if (r.role === 'system') continue;
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

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parsePendingAction(value: Json | null): PendingAction | null {
  const parsed = PendingActionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseClarificationRequired(value: unknown): {
  question: string;
  options: { label: string }[];
  pendingAction: PendingAction;
} | null {
  const root = asObject(value);
  const payload = asObject(root?.__clarification_required);
  if (!payload) return null;
  const question = typeof payload.question === 'string' ? payload.question : null;
  const options = Array.isArray(payload.options)
    ? payload.options
        .map((option) => {
          const item = asObject(option);
          return typeof item?.label === 'string' ? { label: item.label } : null;
        })
        .filter((option): option is { label: string } => option !== null)
    : [];
  const pendingAction = parsePendingAction((payload.pending_action ?? null) as Json | null);
  if (!question || options.length === 0 || !pendingAction) return null;
  return { question, options, pendingAction };
}

function formatTaskDue(result: Record<string, unknown>): string {
  const dueKind = typeof result.due_kind === 'string' ? result.due_kind : null;
  const dueDate = typeof result.due_date_local === 'string' ? result.due_date_local : null;
  const dueLocal = typeof result.due_local === 'string' ? result.due_local : null;
  if (dueKind === 'date' && dueDate) return ` due on ${dueDate}`;
  if (dueDate && dueLocal) return ` for ${dueDate} at ${dueLocal.slice(11, 16)}`;
  return '';
}

function renderDirectAssistantMessage(
  toolName: string,
  result: unknown,
): string {
  const obj = asObject(result);
  if (!obj) return 'Done.';
  if (typeof obj.error === 'string') {
    const reason = typeof obj.reason === 'string' ? obj.reason : obj.error;
    return `I couldn't complete that: ${reason}`;
  }

  if (toolName === 'create_task') {
    const title = typeof obj.title === 'string' ? obj.title : 'the task';
    return `Created "${title}"${formatTaskDue(obj)}.`;
  }
  if (toolName === 'update_task') {
    const title = typeof obj.title === 'string' ? obj.title : 'the task';
    return `Updated "${title}"${formatTaskDue(obj)}.`;
  }
  if (toolName === 'complete_task') {
    const title = typeof obj.title === 'string' ? obj.title : 'the task';
    const completed = typeof obj.completed_at === 'string' && obj.completed_at.length > 0;
    return completed ? `Marked "${title}" complete.` : `Marked "${title}" open again.`;
  }
  if (toolName === 'create_note') {
    const title = typeof obj.title === 'string' && obj.title.length > 0 ? obj.title : 'Untitled';
    return `Created the note "${title}".`;
  }
  if (toolName === 'update_note') {
    const title = typeof obj.title === 'string' && obj.title.length > 0 ? obj.title : 'the note';
    return `Updated "${title}".`;
  }
  if (toolName === 'create_course') {
    const name = typeof obj.name === 'string' ? obj.name : 'the course';
    const code = typeof obj.code === 'string' && obj.code.length > 0 ? `${obj.code} ` : '';
    return `Created the course ${code}${name}.`;
  }
  return 'Done.';
}

export async function POST(request: NextRequest) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const userId = user.id;

  const parsed = RequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(parsed.error.message, { status: 400 });
  }

  let conversationId = parsed.data.conversation_id ?? undefined;
  if (!conversationId) {
    const { data, error } = await supabase
      .from('conversations')
      .insert({
        owner_id: userId,
        title: parsed.data.message.slice(0, 60),
      })
      .select('id')
      .single();
    if (error) return new Response(error.message, { status: 500 });
    conversationId = data.id;
  }

  const [{ data: conversation, error: convErr }, { data: priorRows, error: priorErr }] =
    await Promise.all([
      supabase
        .from('conversations')
        .select('id, pending_action')
        .eq('owner_id', userId)
        .eq('id', conversationId)
        .maybeSingle(),
      supabase
        .from('messages')
        .select('role, content, tool_calls, tool_call_id, name')
        .eq('conversation_id', conversationId)
        .order('created_at'),
    ]);
  if (convErr) return new Response(convErr.message, { status: 500 });
  if (!conversation) return new Response('Conversation not found', { status: 404 });
  if (priorErr) return new Response(priorErr.message, { status: 500 });

  const pendingConversationAction = parsePendingAction((conversation as ConversationRow).pending_action);
  const history = toOpenAIHistory((priorRows ?? []) as DbMessageRow[]);
  const pendingAsk = findPendingClarification((priorRows ?? []) as DbMessageRow[]);
  const clarification = pendingAsk
    ? resolveClarificationReply(parsed.data.message, pendingAsk)
    : { kind: 'unknown', raw: parsed.data.message as string };
  const effectiveMessage =
    clarification.kind === 'unknown'
      ? parsed.data.message
      : canonicalClarificationReply(parsed.data.message, pendingAsk);

  const { data: userMsg, error: userMsgErr } = await supabase
    .from('messages')
      .insert({
        conversation_id: conversationId,
        owner_id: userId,
        role: 'user',
        content: parsed.data.message,
    })
    .select('id, created_at')
    .single();
  if (userMsgErr) return new Response(userMsgErr.message, { status: 500 });

  await rememberUserTz(supabase, userId, parsed.data.tz);
  const userTz = await resolveUserTz(supabase, userId, parsed.data.tz);

  const encoder = new TextEncoder();
  const convId = conversationId;

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      async function updateConversation(pendingAction: PendingAction | null) {
        await supabase
          .from('conversations')
          .update({
            pending_action: (pendingAction ?? null) as unknown as Json,
            updated_at: new Date().toISOString(),
          })
          .eq('id', convId);
      }

      async function insertAssistantMessage(
        content: string | null,
        toolCalls: ChatCompletionMessageToolCall[] | null,
      ) {
        const { data: row } = await supabase
            .from('messages')
            .insert({
              conversation_id: convId,
              owner_id: userId,
              role: 'assistant',
            content,
            tool_calls: (toolCalls ?? null) as unknown as Json,
          })
          .select('id, created_at')
          .single();
        send({
          type: 'assistant_message',
          id: row?.id,
          created_at: row?.created_at,
          content,
          tool_calls: toolCalls,
        });
      }

      async function insertToolMessage(toolCallId: string, name: string, content: string) {
        const { data: row } = await supabase
            .from('messages')
            .insert({
              conversation_id: convId,
              owner_id: userId,
              role: 'tool',
            content,
            tool_call_id: toolCallId,
            name,
          })
          .select('id, created_at')
          .single();
        send({
          type: 'tool_result',
          id: row?.id,
          created_at: row?.created_at,
          tool_call_id: toolCallId,
          name,
          content,
        });
      }

      send({
        type: 'meta',
        conversation_id: convId,
        user_message_id: userMsg.id,
        user_message_created_at: userMsg.created_at,
      });

      try {
        if (pendingConversationAction) {
          const ask = {
            question: pendingConversationAction.question,
            options: pendingConversationAction.options.map((option) => ({ label: option.label })),
          };
          const resolution = resolveClarificationReply(parsed.data.message, ask);

          if (resolution.kind === 'unknown') {
            const askContent = buildClarificationMessage(ask);
            await insertAssistantMessage(askContent, null);
            await updateConversation(pendingConversationAction);
            send({ type: 'done' });
            return;
          }

          if (resolution.kind === 'none') {
            await updateConversation(null);
            await insertAssistantMessage(
              "Those options weren't right. Tell me the exact course or class you want.",
              null,
            );
            send({ type: 'done' });
            return;
          }

          const option = pendingConversationAction.options.find(
            (candidate) => candidate.label === resolution.label,
          );
          if (!option) {
            const askContent = buildClarificationMessage(ask);
            await insertAssistantMessage(askContent, null);
            await updateConversation(pendingConversationAction);
            send({ type: 'done' });
            return;
          }

          const tools = buildTools(supabase, userId, userTz, resolution.label);
          const tool = tools.find(
            (entry) => entry.definition.type === 'function'
              && entry.definition.function.name === pendingConversationAction.tool_name,
          );
          if (!tool) {
            await updateConversation(null);
            send({ type: 'error', message: `Pending tool not found: ${pendingConversationAction.tool_name}` });
            return;
          }

          const finalArgs = applyPendingOption(pendingConversationAction.tool_args, option);
          const toolCallId = `call_pending_${crypto.randomUUID()}`;
          const toolCall: ChatCompletionMessageToolCall = {
            id: toolCallId,
            type: 'function',
            function: {
              name: pendingConversationAction.tool_name,
              arguments: JSON.stringify(finalArgs),
            },
          };

          send({
            type: 'tool_call_start',
            tool_call_id: toolCallId,
            name: pendingConversationAction.tool_name,
          });
          await insertAssistantMessage(null, [toolCall]);

          const result = await tool.handler(finalArgs);
          const resultText = JSON.stringify(result ?? null);
          await insertToolMessage(toolCallId, pendingConversationAction.tool_name, resultText);

          const clarificationRequest = parseClarificationRequired(result);
          if (clarificationRequest) {
            await updateConversation(clarificationRequest.pendingAction);
            await insertAssistantMessage(
              buildClarificationMessage({
                question: clarificationRequest.question,
                options: clarificationRequest.options,
              }),
              null,
            );
            send({ type: 'done' });
            return;
          }

          await updateConversation(null);
          await insertAssistantMessage(
            renderDirectAssistantMessage(pendingConversationAction.tool_name, result),
            null,
          );
          send({ type: 'done' });
          return;
        }

        const context = await buildContext(supabase, userId, userTz);
        const systemPrompt = `${SYSTEM_PROMPT}\n\n${context}`;
        const tools = buildTools(supabase, userId, userTz, effectiveMessage);
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
              await insertAssistantMessage(ev.content, ev.tool_calls ?? null);
            } else if (ev.type === 'tool_result') {
              await insertToolMessage(ev.tool_call_id, ev.name, ev.content);
            } else if (ev.type === 'clarification_requested') {
              const askContent = buildClarificationMessage({
                question: ev.question,
                options: ev.options,
              });
              const pendingAction = ev.pending_action
                ? parsePendingAction(ev.pending_action as Json)
                : null;
              await updateConversation(pendingAction);
              await insertAssistantMessage(askContent, null);
            } else if (ev.type === 'done') {
              await supabase
                .from('conversations')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', convId);
              send({ type: 'done' });
            } else if (ev.type === 'error') {
              send({ type: 'error', message: ev.message });
            }
          },
        });
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
