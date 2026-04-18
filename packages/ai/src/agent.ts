import type OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export interface AgentTool {
  definition: ChatCompletionTool;
  handler: ToolHandler;
}

export type AgentEvent =
  | {
      type: 'assistant_message';
      content: string | null;
      tool_calls: ChatCompletionMessageToolCall[] | null;
    }
  | {
      type: 'tool_result';
      tool_call_id: string;
      name: string;
      content: string;
    }
  | { type: 'done'; content: string }
  | { type: 'error'; message: string };

export interface RunAgentOptions {
  openai: OpenAI;
  model: string;
  systemPrompt: string;
  history: ChatCompletionMessageParam[];
  userMessage: string;
  tools: AgentTool[];
  maxIterations?: number;
  onEvent: (event: AgentEvent) => Promise<void> | void;
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
    const completion = await opts.openai.chat.completions.create({
      model: opts.model,
      messages,
      tools: toolDefs,
      tool_choice: 'auto',
      temperature: 0.3,
    });
    const msg = completion.choices[0]?.message;
    if (!msg) {
      await opts.onEvent({ type: 'error', message: 'Empty completion from model.' });
      return;
    }

    messages.push(msg);

    await opts.onEvent({
      type: 'assistant_message',
      content: msg.content ?? null,
      tool_calls: msg.tool_calls ?? null,
    });

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      await opts.onEvent({ type: 'done', content: msg.content ?? '' });
      return;
    }

    for (const call of msg.tool_calls) {
      if (call.type !== 'function') continue;
      const name = call.function.name;
      const handler = handlers.get(name);

      let resultText: string;
      try {
        let args: Record<string, unknown> = {};
        try {
          const raw = call.function.arguments || '{}';
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>;
        } catch {
          args = {};
        }
        if (!handler) {
          resultText = JSON.stringify({ error: `Unknown tool: ${name}` });
        } else {
          const out = await handler(args);
          resultText = JSON.stringify(out ?? null);
        }
      } catch (err) {
        resultText = JSON.stringify({ error: (err as Error).message ?? 'Tool error' });
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: resultText,
      });
      await opts.onEvent({
        type: 'tool_result',
        tool_call_id: call.id,
        name,
        content: resultText,
      });
    }
  }

  await opts.onEvent({ type: 'error', message: 'Reached max iterations without completion.' });
}
