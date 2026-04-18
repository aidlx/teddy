import { ParsedCaptureSchema, type CourseHint, type ParsedCapture } from '@teddy/shared';
import { getOpenAI } from './client';

const MODEL = 'gpt-4o-mini';

const SYSTEM_PROMPT = `You are Teddy, a study assistant for students. Classify the user's short message as either a task (something to do with a due date) or a note (information to remember).

Rules:
- If the message mentions a deadline, homework, assignment, exam, or something the user must do, it's a "task".
- Otherwise it's a "note".
- For tasks, extract the due date in ISO 8601 UTC. Resolve relative dates like "tomorrow", "Friday", "next lecture" using the provided reference time. If you truly cannot infer a due date, leave due_at null.
- Assign course_id by matching the message to one of the provided courses (by name, code, or topic). If no course matches, leave course_id null.
- title is a concise 3-10 word summary of the action (tasks) or topic (notes).
- For notes, put the full useful content in "content". Keep it close to the original, just cleaned up.
- Do NOT invent due dates, course assignments, or details not in the message.

Respond ONLY with the JSON object. No prose.`;

interface ParseOptions {
  courses: CourseHint[];
  now?: Date;
}

export async function parseCapture(text: string, opts: ParseOptions): Promise<ParsedCapture> {
  const openai = getOpenAI();
  const now = opts.now ?? new Date();

  const courseLines =
    opts.courses.length === 0
      ? '(no courses defined)'
      : opts.courses
          .map((c) => `- id: ${c.id}  name: ${c.name}${c.code ? `  code: ${c.code}` : ''}`)
          .join('\n');

  const userPrompt = `Reference time (UTC): ${now.toISOString()}

Courses available:
${courseLines}

User message:
"""
${text}
"""

Respond with a single JSON object matching one of these shapes:

{
  "type": "task",
  "title": string,
  "description": string | null,
  "due_at": string | null,   // ISO 8601 UTC, or null
  "course_id": string | null // one of the course ids above, or null
}

OR

{
  "type": "note",
  "title": string | null,
  "content": string,
  "course_id": string | null
}`;

  const completion = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: 'json_object' },
    temperature: 0.2,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error('Parser returned empty response.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Parser returned invalid JSON: ${raw.slice(0, 200)}`);
  }

  const result = ParsedCaptureSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Parser output failed validation: ${result.error.message}`);
  }
  return result.data;
}
