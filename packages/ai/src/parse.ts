import { ParsedCaptureSchema, type CourseHint, type ParsedCapture } from '@teddy/shared';
import { getOpenAI } from './client';

const MODEL = 'gpt-4o-mini';

const SYSTEM_PROMPT = `You are Teddy, a study assistant for students. Break the user's short message into one or more items, each classified as either a task (something to do, with or without a due date) or a note (information to remember).

Rules:
- A single message can contain multiple items (e.g. "read chapter 3 for CS101 before Friday AND the teacher mentioned the midterm is on the 20th" = one task + one note, or two tasks). Emit each as a separate item.
- If a sentence describes a deadline, homework, assignment, exam, or something the user must do, it's a "task".
- If it describes information to remember (a fact, a topic covered, a definition), it's a "note".
- For tasks, extract the due date in ISO 8601 UTC. Resolve relative dates like "tomorrow", "Friday", "next lecture" using the provided reference time. If you truly cannot infer a due date, leave due_at null.
- Assign course_id by matching the item to one of the provided courses (by name, code, or topic). If no course matches, leave course_id null. NEVER invent a course id.
- title is a concise 3-10 word summary of the action (tasks) or topic (notes).
- For notes, put the full useful content in "content". Keep it close to the original, just cleaned up.
- Do NOT invent due dates, course assignments, or details not in the message.
- If the message is genuinely one thing, emit one item. Don't split artificially.

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

Respond with a single JSON object of shape:

{
  "items": [
    // one or more of the shapes below
    {
      "type": "task",
      "title": string,
      "description": string | null,
      "due_at": string | null,   // ISO 8601 UTC, or null
      "course_id": string | null // one of the course ids above, or null
    },
    {
      "type": "note",
      "title": string | null,
      "content": string,
      "course_id": string | null
    }
  ]
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
