import { getOpenAI } from './client';

export type TtsVoice = 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse';

export async function speak(
  text: string,
  opts: { voice?: TtsVoice; model?: string; format?: 'mp3' | 'wav' | 'opus' } = {},
): Promise<ArrayBuffer> {
  const openai = getOpenAI();
  const response = await openai.audio.speech.create({
    model: opts.model ?? 'gpt-4o-mini-tts',
    voice: opts.voice ?? 'alloy',
    input: text,
    response_format: opts.format ?? 'mp3',
  });
  return await response.arrayBuffer();
}
