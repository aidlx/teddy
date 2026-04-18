'use client';

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
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
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div
        className={`group flex flex-col gap-3 rounded-2xl border bg-white p-3 transition dark:bg-zinc-950/60 ${
          loading
            ? 'border-amber-400/40 shadow-lg shadow-amber-400/10 dark:border-amber-400/30 dark:shadow-amber-400/5'
            : 'border-zinc-300 focus-within:border-amber-400/50 focus-within:shadow-lg focus-within:shadow-amber-400/10 dark:border-zinc-800 dark:focus-within:border-amber-400/30 dark:focus-within:shadow-amber-400/5'
        }`}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
          placeholder="What did you hear in class? What do you need to do?"
          rows={3}
          className="w-full resize-none bg-transparent px-2 py-1 text-[15px] leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100 dark:placeholder:text-zinc-600"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="hidden text-xs text-zinc-500 sm:block dark:text-zinc-600">
            <kbd className="rounded border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-mono text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              ⌘
            </kbd>{' '}
            <kbd className="rounded border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-mono text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              Enter
            </kbd>{' '}
            to capture
          </span>
          <button
            type="submit"
            disabled={loading || !text.trim()}
            className="ml-auto rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950 shadow-sm shadow-amber-400/30 transition hover:bg-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-400/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none dark:shadow-amber-400/20"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-950" />
                Teddy is thinking
              </span>
            ) : (
              'Capture'
            )}
          </button>
        </div>
      </div>

      {result && result.items.length > 0 && (
        <div className="flex animate-fade-in flex-col gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-100">
          <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
            <span>
              Saved {result.items.length} {result.items.length === 1 ? 'item' : 'items'}
            </span>
            <span className="text-emerald-300 dark:text-emerald-800">·</span>
            <Link
              href={`/captures/${result.captureId}`}
              className="underline decoration-emerald-400 underline-offset-2 hover:text-emerald-800 hover:decoration-emerald-700 dark:decoration-emerald-700 dark:hover:text-emerald-200 dark:hover:decoration-emerald-400"
            >
              view source
            </Link>
          </div>
          {result.items.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="rounded bg-emerald-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                {r.kind}
              </span>
              <span className="truncate text-zinc-900 dark:text-zinc-200">
                {r.item.title ?? (r.kind === 'note' ? 'Note' : 'Untitled')}
              </span>
              {r.kind === 'task' && r.item.due_at && (
                <span className="ml-auto flex-none text-xs text-emerald-700 dark:text-emerald-500">
                  due {new Date(r.item.due_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          {error}
        </p>
      )}
    </form>
  );
}
