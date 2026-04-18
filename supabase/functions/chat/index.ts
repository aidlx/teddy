// Supabase Edge Function: chat
//
// Alternative to the Next.js /api/chat route — use this when you want the
// mobile app to talk to OpenAI directly without a Next.js server in the loop.
// Deploy with: supabase functions deploy chat --no-verify-jwt=false
//
// Requires secrets set via: supabase secrets set OPENAI_API_KEY=sk-...

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return new Response('Server not configured', { status: 500 });

  let body: { messages: ChatMessage[]; model?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response('messages required', { status: 400 });
  }

  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: body.model ?? 'gpt-4o-mini',
      messages: body.messages,
      stream: true,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    return new Response(`Upstream error: ${text}`, { status: 502 });
  }

  // Forward the SSE stream from OpenAI directly to the client.
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});
