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

interface ImageAttachment {
  id: string;
  dataUrl: string;
  name: string;
}

export function AssistantApp() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ConversationSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

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
    async (text: string, attachedImages: ImageAttachment[]) => {
      if ((!text.trim() && attachedImages.length === 0) || sending) return;
      setSending(true);
      setError(null);

      const displayContent =
        attachedImages.length > 0
          ? `${text}${text ? '\n\n' : ''}[${attachedImages.length} image${attachedImages.length === 1 ? '' : 's'} attached]`
          : text;

      const optimistic: UIMessage = {
        id: `tmp-${Date.now()}`,
        role: 'user',
        content: displayContent,
        created_at: new Date().toISOString(),
      };
      setMessages((m) => [...m, optimistic]);
      setImages([]);

      try {
        const res = await fetch('/api/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: conversationId,
            message: text || '(see attached images)',
            images: attachedImages.length > 0 ? attachedImages.map((i) => i.dataUrl) : undefined,
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

  function submit() {
    const text = input.trim();
    if (!text && images.length === 0) return;
    setInput('');
    void handleSend(text, images);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  async function readImageAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error ?? new Error('read failed'));
      reader.readAsDataURL(file);
    });
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    setExtracting(true);
    try {
      for (const file of Array.from(fileList)) {
        if (file.type.startsWith('image/')) {
          if (images.length >= 6) {
            setError('Max 6 images per message.');
            break;
          }
          const dataUrl = await readImageAsDataUrl(file);
          setImages((prev) => [
            ...prev,
            { id: `img-${Date.now()}-${Math.random()}`, dataUrl, name: file.name || 'image' },
          ]);
        } else {
          // Extract text server-side (PDFs + plain text), append to composer
          const form = new FormData();
          form.append('file', file);
          const res = await fetch('/api/extract-file', { method: 'POST', body: form });
          const data = (await res.json().catch(() => ({}))) as {
            text?: string;
            filename?: string;
            truncated?: boolean;
            error?: string;
          };
          if (!res.ok || !data.text) {
            setError(data.error ?? `Couldn't read ${file.name}`);
            continue;
          }
          const header = `[File: ${data.filename ?? file.name}${data.truncated ? ' — truncated' : ''}]`;
          setInput((prev) => `${prev}${prev ? '\n\n' : ''}${header}\n${data.text}`);
        }
      }
    } finally {
      setExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function startRecording() {
    if (recording || transcribing) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];
      // Pick a mime type OpenAI accepts. Chromium defaults to
      // audio/webm;codecs=opus; Safari emits audio/mp4 by default. The newer
      // gpt-4o-*-transcribe models 400 if the extension doesn't match the
      // actual container, so we pick explicitly and name the file to match.
      const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ];
      const mimeType = candidates.find((t) => MediaRecorder.isTypeSupported(t));
      const mr = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        const actualMime = mr.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: actualMime });
        audioChunksRef.current = [];
        if (blob.size < 500) return; // ignore accidental taps
        setTranscribing(true);
        try {
          const ext = actualMime.includes('mp4')
            ? 'mp4'
            : actualMime.includes('ogg')
              ? 'ogg'
              : 'webm';
          const form = new FormData();
          form.append(
            'audio',
            new File([blob], `recording.${ext}`, { type: actualMime }),
          );
          const res = await fetch('/api/transcribe', { method: 'POST', body: form });
          const data = (await res.json().catch(() => ({}))) as {
            text?: string;
            error?: string;
          };
          if (!res.ok || !data.text) {
            setError(data.error ?? 'Transcription failed');
          } else {
            setInput((prev) => (prev ? `${prev} ${data.text}` : (data.text ?? '')));
            textareaRef.current?.focus();
          }
        } finally {
          setTranscribing(false);
        }
      };
      mr.start();
      setRecording(true);
    } catch (err) {
      setError((err as Error).message ?? 'Mic access denied');
    }
  }

  function stopRecording() {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') mr.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
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

      <form onSubmit={onSubmit} className="px-4 pb-4 pt-2 md:px-6 md:pb-6">
        <div className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 shadow-sm focus-within:border-amber-400/50 focus-within:ring-2 focus-within:ring-amber-400/20 dark:border-zinc-800 dark:bg-zinc-950/60">
          {images.length > 0 && (
            <ul className="flex flex-wrap gap-2 px-0.5 pt-1">
              {images.map((img) => (
                <li key={img.id} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    className="h-14 w-14 rounded-md object-cover ring-1 ring-zinc-200 dark:ring-zinc-800"
                  />
                  <button
                    type="button"
                    onClick={() => setImages((prev) => prev.filter((x) => x.id !== img.id))}
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-900 text-[10px] text-white shadow hover:bg-zinc-700 dark:bg-zinc-700 dark:hover:bg-zinc-600"
                    aria-label="Remove image"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf,text/*,.md,.csv,.log,.json,.tsv"
              onChange={(e) => void handleFiles(e.target.files)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={extracting}
              className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-200/60 hover:text-zinc-900 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-900/60 dark:hover:text-zinc-100"
              aria-label="Attach file"
              title="Attach image, PDF, or text file"
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4">
                <path d="M13.5 7L8 12.5a2.5 2.5 0 103.54 3.54L17 10.5a4 4 0 00-5.66-5.66L5.5 10.68a5.5 5.5 0 007.78 7.78L18 13.8" strokeLinecap="round" />
              </svg>
            </button>
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                void startRecording();
              }}
              onPointerUp={(e) => {
                e.preventDefault();
                stopRecording();
              }}
              onPointerLeave={() => {
                if (recording) stopRecording();
              }}
              disabled={transcribing}
              className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg transition disabled:opacity-40 ${
                recording
                  ? 'bg-rose-500 text-white shadow-sm'
                  : 'text-zinc-500 hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900/60 dark:hover:text-zinc-100'
              }`}
              aria-label={recording ? 'Recording — release to send' : 'Hold to talk'}
              title="Hold to talk"
            >
              {transcribing ? (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M10 13a3 3 0 003-3V5a3 3 0 10-6 0v5a3 3 0 003 3z" />
                  <path d="M5 10a5 5 0 0010 0h-1.5a3.5 3.5 0 01-7 0H5zm4.25 5.95V18h1.5v-2.05a6 6 0 005-5.95H14a4.5 4.5 0 01-9 0H3.5a6 6 0 005.75 5.95z" />
                </svg>
              )}
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={
                recording
                  ? 'Recording… release to send'
                  : transcribing
                    ? 'Transcribing…'
                    : extracting
                      ? 'Reading file…'
                      : "Tell Teddy what's going on…"
              }
              className="flex-1 resize-none bg-transparent py-1.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-600"
              style={{ maxHeight: '8rem' }}
            />
            <button
              type="submit"
              disabled={sending || (!input.trim() && images.length === 0)}
              className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-amber-400 text-zinc-950 shadow-sm transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Send"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M3 10l14-7-7 14-2-6-5-1z" />
              </svg>
            </button>
          </div>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-zinc-400 dark:text-zinc-600">
          Enter to send · Shift+Enter for newline · Hold mic to talk
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
