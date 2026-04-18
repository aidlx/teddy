import { getOpenAI, } from './client';
import { toFile } from 'openai/uploads';

export async function transcribe(
  audio: Blob | ArrayBuffer | Uint8Array,
  opts: { filename?: string; model?: string; language?: string } = {},
): Promise<string> {
  const openai = getOpenAI();
  const file = await toFile(audio, opts.filename ?? 'audio.webm');
  const result = await openai.audio.transcriptions.create({
    file,
    model: opts.model ?? 'whisper-1',
    language: opts.language,
  });
  return result.text;
}
