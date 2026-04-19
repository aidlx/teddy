import type OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
  ChatCompletionUserMessageParam,
} from 'openai/resources/chat/completions';

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export interface AgentTool {
  definition: ChatCompletionTool;
  handler: ToolHandler;
}

interface ClarificationToolResult {
  __ask_clarification: {
    question: string;
    options: { label: string }[];
  };
}

export type AgentEvent =
  | { type: 'assistant_delta'; content_delta: string }
  | { type: 'tool_call_start'; tool_call_id: string; name: string }
  | {
      type: 'assistant_message';
      content: string | null;
      tool_calls: ChatCompletionMessageToolCall[] | null;
    }
  | { type: 'clarification_requested'; question: string; options: { label: string }[] }
  | { type: 'tool_result'; tool_call_id: string; name: string; content: string }
  | { type: 'done'; content: string }
  | { type: 'error'; message: string };

export interface RunAgentOptions {
  openai: OpenAI;
  model: string;
  systemPrompt: string;
  history: ChatCompletionMessageParam[];
  userMessage: ChatCompletionUserMessageParam['content'];
  tools: AgentTool[];
  maxIterations?: number;
  onEvent: (event: AgentEvent) => Promise<void> | void;
}

function isClarificationToolResult(value: unknown): value is ClarificationToolResult {
  if (!value || typeof value !== 'object' || !('__ask_clarification' in value)) return false;
  const ask = (value as ClarificationToolResult).__ask_clarification;
  return (
    !!ask &&
    typeof ask.question === 'string' &&
    Array.isArray(ask.options) &&
    ask.options.every((option) => option && typeof option.label === 'string')
  );
}

export async function runAgent(opts: RunAgentOptions): Promise<void> {
  const toolDefs = opts.tools.map((t) => t.definition);
  const handlers = new Map<string, ToolHandler>();
  for (const t of opts.tools) handlers.set(t.definition.function.name, t.handler);

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: opts.systemPrompt },
    ...opts.history,
    { role: 'user', content: opts.userMessage },
  ];

  const max = opts.maxIterations ?? 8;
  for (let i = 0; i < max; i++) {
    const stream = await opts.openai.chat.completions.create({
      model: opts.model,
      messages,
      tools: toolDefs,
      tool_choice: 'auto',
      parallel_tool_calls: false,
      temperature: 0.3,
      stream: true,
    });

    let content = '';
    const toolCalls: ChatCompletionMessageToolCall[] = [];
    const announced = new Set<number>();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        content += delta.content;
        await opts.onEvent({ type: 'assistant_delta', content_delta: delta.content });
      }
      if (delta.tool_calls) {
        for (const tcDelta of delta.tool_calls) {
          const idx = tcDelta.index;
          let tc = toolCalls[idx];
          if (!tc) {
            tc = { id: tcDelta.id ?? '', type: 'function', function: { name: '', arguments: '' } };
            toolCalls[idx] = tc;
          }
          if (tcDelta.id) tc.id = tcDelta.id;
          if (tcDelta.function?.name) tc.function.name += tcDelta.function.name;
          if (tcDelta.function?.arguments) tc.function.arguments += tcDelta.function.arguments;
          if (!announced.has(idx) && tc.id && tc.function.name) {
            announced.add(idx);
            await opts.onEvent({
              type: 'tool_call_start',
              tool_call_id: tc.id,
              name: tc.function.name,
            });
          }
        }
      }
    }

    const assistantMsg: ChatCompletionMessageParam =
      toolCalls.length > 0
        ? { role: 'assistant', content: content || null, tool_calls: toolCalls }
        : { role: 'assistant', content: content || null };
    messages.push(assistantMsg);

    await opts.onEvent({
      type: 'assistant_message',
      content: content || null,
      tool_calls: toolCalls.length > 0 ? toolCalls : null,
    });

    if (toolCalls.length === 0) {
      await opts.onEvent({ type: 'done', content });
      return;
    }

    let clarification: ClarificationToolResult['__ask_clarification'] | null = null;
    for (const call of toolCalls) {
      if (!call || call.type !== 'function') continue;
      const name = call.function.name;
      const handler = handlers.get(name);

      let resultText: string | undefined;
      try {
        if (!handler) {
          resultText = JSON.stringify({ error: `Unknown tool: ${name}` });
        } else {
          const raw = call.function.arguments || '{}';
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            resultText = JSON.stringify({
              error: 'invalid_tool_arguments',
              reason: `Tool "${name}" received invalid JSON arguments.`,
            });
            parsed = null;
          }
          if (resultText === undefined) {
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              resultText = JSON.stringify({
                error: 'invalid_tool_arguments',
                reason: `Tool "${name}" expects a JSON object for arguments.`,
              });
            } else {
              const out = await handler(parsed as Record<string, unknown>);
              if (isClarificationToolResult(out)) {
                clarification = out.__ask_clarification;
              }
              resultText = JSON.stringify(out ?? null);
            }
          }
        }
      } catch (err) {
        resultText = JSON.stringify({ error: (err as Error).message ?? 'Tool error' });
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: resultText ?? JSON.stringify({ error: 'Tool returned no result' }),
      });
      await opts.onEvent({
        type: 'tool_result',
        tool_call_id: call.id,
        name,
        content: resultText ?? JSON.stringify({ error: 'Tool returned no result' }),
      });
    }

    if (clarification) {
      await opts.onEvent({
        type: 'clarification_requested',
        question: clarification.question,
        options: clarification.options,
      });
      await opts.onEvent({ type: 'done', content: '' });
      return;
    }
  }

  await opts.onEvent({ type: 'error', message: 'Reached max iterations without completion.' });
}
