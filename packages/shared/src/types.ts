import type { z } from 'zod';
import type { ChatMessageSchema, ChatRequestSchema, ChatResponseSchema } from './schemas';

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

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
