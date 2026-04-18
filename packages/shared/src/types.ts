import type { z } from 'zod';
import type {
  ChatMessageSchema,
  ChatRequestSchema,
  ChatResponseSchema,
  CourseHintSchema,
  ParsedCaptureSchema,
  ParsedTaskSchema,
  ParsedNoteSchema,
  CaptureRequestSchema,
} from './schemas';

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

export type CourseHint = z.infer<typeof CourseHintSchema>;
export type ParsedCapture = z.infer<typeof ParsedCaptureSchema>;
export type ParsedTask = z.infer<typeof ParsedTaskSchema>;
export type ParsedNote = z.infer<typeof ParsedNoteSchema>;
export type CaptureRequest = z.infer<typeof CaptureRequestSchema>;

export interface UserProfile {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface StoredFile {
  id: string;
  ownerId: string;
  name: string;
  mimeType: string;
  size: number;
  storagePath: string;
  createdAt: string;
}
