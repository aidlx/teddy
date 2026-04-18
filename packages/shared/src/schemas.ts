import { z } from 'zod';

export const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

export const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1),
  model: z.string().optional(),
});

export const ChatResponseSchema = z.object({
  message: ChatMessageSchema,
});

export const FileUploadSchema = z.object({
  name: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
});

// ─────────────────────────────────────────────────────────────
// Capture parser — the AI turns raw text into one of these.
// ─────────────────────────────────────────────────────────────

export const CourseHintSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable().optional(),
});

export const ParsedTaskSchema = z.object({
  type: z.literal('task'),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  due_at: z.string().datetime().nullable().optional(),
  course_id: z.string().uuid().nullable().optional(),
});

export const ParsedNoteSchema = z.object({
  type: z.literal('note'),
  title: z.string().nullable().optional(),
  content: z.string().min(1),
  course_id: z.string().uuid().nullable().optional(),
});

export const ParsedItemSchema = z.discriminatedUnion('type', [
  ParsedTaskSchema,
  ParsedNoteSchema,
]);

// The LLM emits { items: [...] } — object at the top level is required by JSON mode.
export const ParsedCaptureSchema = z.object({
  items: z.array(ParsedItemSchema).min(1),
});

export const CaptureRequestSchema = z.object({
  text: z.string().min(1).max(5000),
});
