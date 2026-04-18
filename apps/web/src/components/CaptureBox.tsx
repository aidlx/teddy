'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type CaptureResult = {
  kind: 'task' | 'note';
  item: { id: string; title?: string | null; course_id: string | null; due_at?: string | null };
};

export function CaptureBox() {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);

    const res = await fetch('/api/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim() }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? `Capture failed (${res.status})`);
      setLoading(false);
      return;
    }

    setResult(data as CaptureResult);
    setText('');
    setLoading(false);
    textareaRef.current?.focus();
    router.refresh();
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

      {result && (
        <div className="rounded-md border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          Saved as {result.kind === 'task' ? 'a task' : 'a note'}
          {result.item.title ? `: "${result.item.title}"` : ''}
          {result.kind === 'task' && result.item.due_at
            ? ` · due ${new Date(result.item.due_at).toLocaleString()}`
            : ''}
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
