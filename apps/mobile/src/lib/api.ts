import type { ChatMessage } from '@teddy/shared';

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? 'http://localhost:3000';

export async function sendChat(messages: ChatMessage[], accessToken: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) throw new Error(`Chat request failed: ${res.status}`);
  return await res.text();
}
