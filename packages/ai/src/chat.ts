import type { ChatMessage } from '@teddy/shared';
import { getOpenAI } from './client';

const DEFAULT_MODEL = 'gpt-4o-mini';

export async function chat(
  messages: ChatMessage[],
  opts: { model?: string } = {},
): Promise<ChatMessage> {
  const openai = getOpenAI();
  const completion = await openai.chat.completions.create({
    model: opts.model ?? DEFAULT_MODEL,
    messages,
  });
  const reply = completion.choices[0]?.message;
  if (!reply?.content) throw new Error('OpenAI returned an empty response.');
  return { role: 'assistant', content: reply.content };
}

export async function* streamChat(
  messages: ChatMessage[],
  opts: { model?: string } = {},
): AsyncGenerator<string, void, void> {
  const openai = getOpenAI();
  const stream = await openai.chat.completions.create({
    model: opts.model ?? DEFAULT_MODEL,
    messages,
    stream: true,
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}
