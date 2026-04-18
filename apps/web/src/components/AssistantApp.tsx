'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface UIMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[] | null;
  tool_call_id?: string | null;
  name?: string | null;
  created_at: string;
}

interface ConversationSummary {
  id: string;
  title: string | null;
  updated_at: string;
}

export function AssistantApp() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ConversationSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void loadHistory();
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function loadHistory() {
    try {
      const res = await fetch('/api/assistant/conversations');
      if (!res.ok) return;
      const data = (await res.json()) as { conversations: ConversationSummary[] };
      setHistory(data.conversations ?? []);
    } catch {
      /* silent */
    }
  }

  async function loadConversation(id: string) {
    setError(null);
    setShowHistory(false);
    const res = await fetch(`/api/assistant/conversations/${id}`);
    if (!res.ok) {
      setError(`Failed to load conversation (${res.status})`);
      return;
    }
    const data = (await res.json()) as {
      conversation: ConversationSummary;
      messages: UIMessage[];
    };
    setConversationId(data.conversation.id);
    setMessages(data.messages);
  }

  function newChat() {
    setConversationId(null);
    setMessages([]);
    setError(null);
    setShowHistory(false);
    textareaRef.current?.focus();
  }

  const handleSend = useCallback(
    async (text: string) => {
      if (!text.trim() || sending) return;
      setSending(true);
      setError(null);

      const optimistic: UIMessage = {
        id: `tmp-${Date.now()}`,
        role: 'user',
        content: text,
        created_at: new Date().toISOString(),
      };
      setMessages((m) => [...m, optimistic]);

      try {
        const res = await fetch('/api/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: conversationId,
            message: text,
          }),
        });
        if (!res.ok || !res.body) {
          const body = await res.text().catch(() => '');
          throw new Error(body.slice(0, 300) || `HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buf.indexOf('\n\n')) !== -1) {
            const chunk = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            const line = chunk.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            let ev: Record<string, unknown>;
            try {
              ev = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            handleEvent(ev);
          }
        }
      } catch (err) {
        setError((err as Error).message ?? 'Request failed');
      } finally {
        setSending(false);
        void loadHistory();
      }
    },
    [conversationId, sending],
  );

  function handleEvent(ev: Record<string, unknown>) {
    const type = ev.type as string;
    if (type === 'meta') {
      const convId = ev.conversation_id as string;
      const userMessageId = ev.user_message_id as string;
      const createdAt = ev.user_message_created_at as string;
      setConversationId(convId);
      setMessages((m) =>
        m.map((msg) =>
          msg.id.startsWith('tmp-')
            ? { ...msg, id: userMessageId, created_at: createdAt }
            : msg,
        ),
      );
    } else if (type === 'assistant_message') {
      const msg: UIMessage = {
        id: (ev.id as string) ?? `asst-${Date.now()}-${Math.random()}`,
        role: 'assistant',
        content: (ev.content as string | null) ?? null,
        tool_calls: (ev.tool_calls as ToolCall[] | null) ?? null,
        created_at: (ev.created_at as string) ?? new Date().toISOString(),
      };
      setMessages((m) => [...m, msg]);
    } else if (type === 'tool_result') {
      const msg: UIMessage = {
        id: (ev.id as string) ?? `tool-${Date.now()}-${Math.random()}`,
        role: 'tool',
        content: (ev.content as string) ?? '',
        tool_call_id: ev.tool_call_id as string,
        name: ev.name as string,
        created_at: (ev.created_at as string) ?? new Date().toISOString(),
      };
      setMessages((m) => [...m, msg]);
    } else if (type === 'error') {
      setError((ev.message as string) ?? 'Agent error');
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    void handleSend(text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = input.trim();
      if (!text) return;
      setInput('');
      void handleSend(text);
    }
  }

  const empty = messages.length === 0;

  return (
    <div className="mx-auto flex h-[100dvh] max-w-3xl flex-col">
      <header className="flex items-center justify-between px-4 py-3 md:px-6">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/10 ring-1 ring-amber-400/30 dark:ring-amber-400/20">
            <span className="text-base" aria-hidden>
              🧸
            </span>
          </span>
          <span className="text-sm font-semibold tracking-tight">Teddy</span>
        </div>
        <nav className="flex items-center gap-1 text-xs">
          <HeaderLink href="/tasks">Tasks</HeaderLink>
          <HeaderLink href="/notes">Notes</HeaderLink>
          <HeaderLink href="/calendar">Calendar</HeaderLink>
          <HeaderLink href="/courses">Courses</HeaderLink>
          <div className="relative">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="rounded-md px-2 py-1.5 text-zinc-600 transition hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900/60 dark:hover:text-zinc-100"
            >
              History
            </button>
            {showHistory && (
              <div className="absolute right-0 z-10 mt-1 w-72 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
                <ul className="max-h-80 overflow-y-auto py-1">
                  {history.length === 0 && (
                    <li className="px-3 py-2 text-xs text-zinc-500">No prior conversations.</li>
                  )}
                  {history.map((h) => (
                    <li key={h.id}>
                      <button
                        onClick={() => loadConversation(h.id)}
                        className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-xs transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
                      >
                        <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                          {h.title ?? '(untitled)'}
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          {new Date(h.updated_at).toLocaleString()}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <button
            onClick={newChat}
            className="rounded-md bg-amber-400/10 px-2.5 py-1.5 font-medium text-amber-700 ring-1 ring-amber-400/30 transition hover:bg-amber-400/20 dark:text-amber-300 dark:ring-amber-400/20"
          >
            New
          </button>
        </nav>
      </header>

      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 md:px-6">
        {empty ? <EmptyState /> : <MessageList messages={messages} />}
        {error && (
          <div className="my-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
            {error}
          </div>
        )}
        {sending && <ThinkingDots />}
      </div>

      <form
        onSubmit={onSubmit}
        className="px-4 pb-4 pt-2 md:px-6 md:pb-6"
      >
        <div className="flex items-end gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 shadow-sm focus-within:border-amber-400/50 focus-within:ring-2 focus-within:ring-amber-400/20 dark:border-zinc-800 dark:bg-zinc-950/60">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Tell Teddy what's going on…"
            className="flex-1 resize-none bg-transparent py-1.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-600"
            style={{ maxHeight: '8rem' }}
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-amber-400 text-zinc-950 shadow-sm transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Send"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M3 10l14-7-7 14-2-6-5-1z" />
            </svg>
          </button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-zinc-400 dark:text-zinc-600">
          Enter to send · Shift+Enter for newline
        </p>
      </form>
    </div>
  );
}

function HeaderLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="rounded-md px-2 py-1.5 text-zinc-600 transition hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900/60 dark:hover:text-zinc-100"
    >
      {children}
    </a>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/10 ring-1 ring-amber-400/30 dark:ring-amber-400/20">
        <span className="text-2xl" aria-hidden>
          🧸
        </span>
      </div>
      <p className="max-w-sm text-sm text-zinc-600 dark:text-zinc-400">
        Tell me what happened in class, what you need to do, or ask about your schedule. I&apos;ll
        figure out where it goes.
      </p>
    </div>
  );
}

function ThinkingDots() {
  return (
    <div className="my-2 flex items-center gap-1.5 px-1 py-2 text-zinc-500">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400 [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400 [animation-delay:300ms]" />
    </div>
  );
}

function MessageList({ messages }: { messages: UIMessage[] }) {
  return (
    <ul className="flex flex-col gap-4 py-4">
      {messages.map((m) => (
        <MessageBlock key={m.id} message={m} />
      ))}
    </ul>
  );
}

function MessageBlock({ message }: { message: UIMessage }) {
  if (message.role === 'user') {
    return (
      <li className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-amber-400 px-4 py-2 text-sm text-zinc-950 shadow-sm">
          {message.content}
        </div>
      </li>
    );
  }

  if (message.role === 'tool') {
    return (
      <li>
        <ToolResultChip
          name={message.name ?? 'tool'}
          content={message.content ?? ''}
        />
      </li>
    );
  }

  // assistant
  return (
    <li className="flex flex-col gap-2">
      {message.content && (
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-zinc-100 px-4 py-2 text-sm text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100">
          {message.content}
        </div>
      )}
      {message.tool_calls && message.tool_calls.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {message.tool_calls.map((tc) => (
            <li key={tc.id}>
              <ToolCallChip name={tc.function.name} rawArgs={tc.function.arguments} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function ToolCallChip({ name, rawArgs }: { name: string; rawArgs: string }) {
  const [open, setOpen] = useState(false);
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(rawArgs || '{}'), null, 2);
    } catch {
      return rawArgs;
    }
  }, [rawArgs]);
  return (
    <div className="rounded-lg border border-zinc-200 bg-white/50 px-2.5 py-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-950/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left text-zinc-600 dark:text-zinc-400"
      >
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-3 w-3 flex-none transition ${open ? 'rotate-90' : ''}`}
        >
          <path d="M7 5l6 5-6 5V5z" />
        </svg>
        <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400">
          {name}
        </span>
        <span className="truncate text-[11px] text-zinc-400">
          {rawArgs && rawArgs !== '{}' ? rawArgs : ''}
        </span>
      </button>
      {open && (
        <pre className="mt-1.5 overflow-x-auto rounded bg-zinc-50 p-2 font-mono text-[10px] leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {pretty}
        </pre>
      )}
    </div>
  );
}

function ToolResultChip({ name, content }: { name: string; content: string }) {
  const [open, setOpen] = useState(false);
  const parsed = useMemo(() => {
    try {
      return JSON.parse(content);
    } catch {
      return content;
    }
  }, [content]);
  const pretty = useMemo(() => {
    if (typeof parsed === 'string') return parsed;
    try {
      return JSON.stringify(parsed, null, 2);
    } catch {
      return String(parsed);
    }
  }, [parsed]);
  const summary = useMemo(() => {
    if (Array.isArray(parsed)) return `${parsed.length} row${parsed.length === 1 ? '' : 's'}`;
    if (parsed && typeof parsed === 'object') {
      if ('error' in parsed) return `error: ${(parsed as { error: unknown }).error}`;
      if ('id' in parsed) return `id: ${(parsed as { id: unknown }).id}`;
      return 'object';
    }
    return typeof parsed === 'string' ? parsed.slice(0, 80) : '';
  }, [parsed]);

  return (
    <div className="rounded-lg border border-emerald-200/60 bg-emerald-50/40 px-2.5 py-1.5 text-xs dark:border-emerald-900/30 dark:bg-emerald-950/20">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left text-emerald-800 dark:text-emerald-300"
      >
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-3 w-3 flex-none transition ${open ? 'rotate-90' : ''}`}
        >
          <path d="M7 5l6 5-6 5V5z" />
        </svg>
        <span className="font-mono text-[11px]">← {name}</span>
        <span className="truncate text-[11px] opacity-70">{summary}</span>
      </button>
      {open && (
        <pre className="mt-1.5 max-h-64 overflow-auto rounded bg-white p-2 font-mono text-[10px] leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {pretty}
        </pre>
      )}
    </div>
  );
}
