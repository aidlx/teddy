'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type CreatedItem = {
  kind: 'task' | 'note';
  item: {
    id: string;
    title?: string | null;
    content?: string | null;
    course_id: string | null;
    due_at?: string | null;
  };
};

type CaptureResponse = {
  captureId: string;
  items: CreatedItem[];
};

export function CaptureBox() {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CaptureResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setText('');
    textareaRef.current?.focus();

    const res = await fetch('/api/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: value }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? `Capture failed (${res.status})`);
      setText(value);
      setLoading(false);
      return;
    }

    setResult(data as CaptureResponse);
    setLoading(false);
    startTransition(() => router.refresh());
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit(e as unknown as React.FormEvent);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
        placeholder="What did you hear in class? What do you need to do?"
        rows={3}
        className="w-full resize-none rounded-md border border-zinc-700 bg-transparent px-4 py-3 text-sm focus:border-zinc-500 focus:outline-none"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500">Cmd/Ctrl + Enter to send</span>
        <button
          type="submit"
          disabled={loading || !text.trim()}
          className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black hover:bg-zinc-200 disabled:opacity-50"
        >
          {loading ? 'Teddy is thinking…' : 'Capture'}
        </button>
      </div>

      {result && result.items.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          <div className="text-xs text-emerald-400">
            Saved {result.items.length} {result.items.length === 1 ? 'item' : 'items'}
            {' · '}
            <a href={`/captures/${result.captureId}`} className="underline hover:text-emerald-200">
              view source
            </a>
          </div>
          {result.items.map((r, i) => (
            <div key={i}>
              <span className="text-emerald-400">{r.kind}:</span>{' '}
              {r.item.title ?? (r.kind === 'note' ? 'Note' : 'Untitled')}
              {r.kind === 'task' && r.item.due_at
                ? ` · due ${new Date(r.item.due_at).toLocaleString()}`
                : ''}
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
