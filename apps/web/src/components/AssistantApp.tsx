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
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  parseClarificationAsk,
  resolveClarificationReply,
  type ClarificationResolution,
} from '@/lib/assistant/clarify';

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

type Status =
  | { kind: 'thinking' }
  | { kind: 'calling'; name: string }
  | null;

interface Turn {
  user: UIMessage;
  userSelection: Extract<ClarificationResolution, { kind: 'option' | 'none' }> | null;
  intermediate: UIMessage[];
  final: UIMessage | null;
}

function buildTurns(messages: UIMessage[]): Turn[] {
  const turns: Turn[] = [];
  let pendingAsk = null as ReturnType<typeof parseClarificationAsk>;
  for (const m of messages) {
    if (m.role === 'user') {
      const selection =
        pendingAsk && m.content
          ? resolveClarificationReply(m.content, pendingAsk)
          : ({ kind: 'unknown', raw: m.content ?? '' } as ClarificationResolution);
      turns.push({
        user: m,
        userSelection: selection.kind === 'unknown' ? null : selection,
        intermediate: [],
        final: null,
      });
      pendingAsk = null;
      continue;
    }
    const last = turns[turns.length - 1];
    if (!last) continue;
    const isFinalAssistant =
      m.role === 'assistant' && !(m.tool_calls && m.tool_calls.length > 0);
    if (isFinalAssistant) {
      last.final = m;
      pendingAsk = parseClarificationAsk(m.content);
    } else {
      last.intermediate.push(m);
    }
  }
  return turns;
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
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);

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
  }, [messages, streamingContent, status]);

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
      setStreamingContent(null);
      setStatus({ kind: 'thinking' });

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
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
        setStatus(null);
        setStreamingContent(null);
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
    } else if (type === 'assistant_delta') {
      const delta = (ev.content_delta as string) ?? '';
      if (!delta) return;
      setStreamingContent((prev) => (prev ?? '') + delta);
      setStatus(null);
    } else if (type === 'tool_call_start') {
      const name = (ev.name as string) ?? 'tool';
      setStatus({ kind: 'calling', name });
    } else if (type === 'assistant_message') {
      const msg: UIMessage = {
        id: (ev.id as string) ?? `asst-${Date.now()}-${Math.random()}`,
        role: 'assistant',
        content: (ev.content as string | null) ?? null,
        tool_calls: (ev.tool_calls as ToolCall[] | null) ?? null,
        created_at: (ev.created_at as string) ?? new Date().toISOString(),
      };
      setMessages((m) => [...m, msg]);
      setStreamingContent(null);
      // If this turn still has tool calls queued, we're about to execute them.
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const firstName = msg.tool_calls[0]?.function.name ?? 'tool';
        setStatus({ kind: 'calling', name: firstName });
      } else {
        setStatus(null);
      }
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
      setStatus({ kind: 'thinking' });
    } else if (type === 'done') {
      setStatus(null);
    } else if (type === 'error') {
      setError((ev.message as string) ?? 'Agent error');
      setStatus(null);
    }
  }

  const handleOptionPick = useCallback(
    (label: string) => {
      if (sending) return;
      void handleSend(label, []);
    },
    [sending, handleSend],
  );

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
        if (blob.size < 500) return;
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

  const turns = useMemo(() => buildTurns(messages), [messages]);
  const empty = messages.length === 0 && streamingContent === null;

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
        {empty ? (
          <EmptyState />
        ) : (
          <TurnList
            turns={turns}
            streamingContent={streamingContent}
            status={status}
            sending={sending}
            onOptionPick={handleOptionPick}
          />
        )}
        {error && (
          <div className="my-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
            {error}
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="px-4 pb-4 pt-2 md:px-6 md:pb-6">
        <div
          className={`flex flex-col gap-2 rounded-2xl border bg-white px-3 py-2 shadow-sm transition focus-within:border-amber-400/50 focus-within:ring-2 focus-within:ring-amber-400/20 dark:bg-zinc-950/60 ${
            sending
              ? 'border-amber-400/40 ring-2 ring-amber-400/10 dark:border-amber-400/30'
              : 'border-zinc-200 dark:border-zinc-800'
          }`}
        >
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

function TurnList({
  turns,
  streamingContent,
  status,
  sending,
  onOptionPick,
}: {
  turns: Turn[];
  streamingContent: string | null;
  status: Status;
  sending: boolean;
  onOptionPick: (label: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-4 py-4">
      {turns.map((t, i) => {
        const isLast = i === turns.length - 1;
        const resolvedSelection = turns[i + 1]?.userSelection ?? null;
        return (
          <TurnBlock
            key={t.user.id}
            turn={t}
            resolvedSelection={resolvedSelection}
            streamingContent={isLast ? streamingContent : null}
            status={isLast && sending ? status : null}
            onOptionPick={onOptionPick}
          />
        );
      })}
    </ul>
  );
}

function TurnBlock({
  turn,
  resolvedSelection,
  streamingContent,
  status,
  onOptionPick,
}: {
  turn: Turn;
  resolvedSelection: Extract<ClarificationResolution, { kind: 'option' | 'none' }> | null;
  streamingContent: string | null;
  status: Status;
  onOptionPick: (label: string) => void;
}) {
  const finalAsk = turn.final ? parseClarificationAsk(turn.final.content) : null;
  const finalContent = turn.final?.content;
  const finalPlainContent = finalAsk ? null : finalContent;

  return (
    <li className="flex flex-col gap-2">
      <UserBubble content={turn.user.content} selection={turn.userSelection} />

      {turn.intermediate.length > 0 && (
        <ThinkingBlock messages={turn.intermediate} />
      )}

      {finalPlainContent && (
        <AssistantBubble content={finalPlainContent} />
      )}

      {finalAsk && (
        <ClarificationCard
          question={finalAsk.question}
          options={finalAsk.options}
          resolvedSelection={resolvedSelection}
          onPick={onOptionPick}
        />
      )}

      {streamingContent !== null && (
        <AssistantBubble content={streamingContent} streaming />
      )}

      {status && <StatusLine status={status} />}
    </li>
  );
}

function UserBubble({
  content,
  selection,
}: {
  content: string | null;
  selection: Extract<ClarificationResolution, { kind: 'option' | 'none' }> | null;
}) {
  const raw = content ?? '';
  const resolved = selection?.label ?? raw;
  const showRaw = selection && raw.trim() && raw.trim() !== resolved.trim();

  return (
    <div className="flex justify-end">
      <div className="flex max-w-[80%] flex-col gap-1 rounded-2xl bg-amber-400 px-4 py-2 text-sm text-zinc-950 shadow-sm">
        <div className="whitespace-pre-wrap">
          {resolved}
        </div>
        {showRaw && (
          <div className="text-[11px] text-zinc-800/70">
            typed: {raw}
          </div>
        )}
      </div>
    </div>
  );
}

function AssistantBubble({ content, streaming }: { content: string; streaming?: boolean }) {
  return (
    <div className="max-w-[85%] rounded-2xl bg-zinc-100 px-4 py-2 text-sm text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100">
      <MarkdownContent content={content} />
      {streaming && (
        <span className="ml-0.5 inline-block h-3.5 w-0.5 translate-y-0.5 animate-pulse bg-zinc-500 align-middle dark:bg-zinc-400" />
      )}
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-1.5 list-disc space-y-0.5 pl-5 first:mt-0 last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-1.5 list-decimal space-y-0.5 pl-5 first:mt-0 last:mb-0">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-snug">{children}</li>,
          h1: ({ children }) => (
            <h1 className="mb-1.5 mt-2 text-base font-semibold first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-1.5 mt-2 text-sm font-semibold first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h3>
          ),
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-amber-700 underline decoration-amber-400/50 underline-offset-2 hover:decoration-amber-500 dark:text-amber-300"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-1.5 border-l-2 border-zinc-300 pl-3 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-2 border-zinc-200 dark:border-zinc-800" />,
          code: ({ className, children }) => {
            const isBlock = /language-/.test(className ?? '');
            if (isBlock) {
              return <code className="font-mono text-[12px] leading-relaxed">{children}</code>;
            }
            return (
              <code className="rounded bg-zinc-200/70 px-1 py-0.5 font-mono text-[12px] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-1.5 overflow-x-auto rounded-lg bg-zinc-900 px-3 py-2 text-zinc-100 first:mt-0 last:mb-0 dark:bg-zinc-950">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-1.5 overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-zinc-300 px-2 py-1 text-left font-semibold dark:border-zinc-700">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-zinc-200 px-2 py-1 dark:border-zinc-800">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function StatusLine({ status }: { status: NonNullable<Status> }) {
  const label =
    status.kind === 'thinking'
      ? 'Thinking'
      : `Calling ${status.name}`;
  return (
    <div className="flex items-center gap-2 px-1 py-1 text-xs text-zinc-500 dark:text-zinc-400">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
      </span>
      <span>{label}</span>
      <span className="inline-flex gap-0.5">
        <span className="h-1 w-1 animate-pulse rounded-full bg-zinc-400" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-zinc-400 [animation-delay:150ms]" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-zinc-400 [animation-delay:300ms]" />
      </span>
    </div>
  );
}

function ThinkingBlock({ messages }: { messages: UIMessage[] }) {
  const [open, setOpen] = useState(false);
  const toolNames = useMemo(() => {
    const names = new Set<string>();
    for (const m of messages) {
      if (m.role === 'assistant' && m.tool_calls) {
        for (const tc of m.tool_calls) names.add(tc.function.name);
      }
    }
    return Array.from(names);
  }, [messages]);
  const summary = toolNames.length > 0 ? toolNames.join(', ') : `${messages.length} step${messages.length === 1 ? '' : 's'}`;

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left text-xs text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-3 w-3 flex-none transition-transform ${open ? 'rotate-90' : ''}`}
        >
          <path d="M7 5l6 5-6 5V5z" />
        </svg>
        <span className="font-medium">Thinking</span>
        <span className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">
          {summary}
        </span>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-1.5 border-l border-zinc-200 pl-3 dark:border-zinc-800">
          {messages.map((m) => {
            if (m.role === 'tool') {
              return (
                <ToolResultChip
                  key={m.id}
                  name={m.name ?? 'tool'}
                  content={m.content ?? ''}
                />
              );
            }
            return (
              <div key={m.id} className="flex flex-col gap-1">
                {m.content && (
                  <div className="text-[12px] text-zinc-700 dark:text-zinc-300">
                    <MarkdownContent content={m.content} />
                  </div>
                )}
                {m.tool_calls?.map((tc) => (
                  <ToolCallChip
                    key={tc.id}
                    name={tc.function.name}
                    rawArgs={tc.function.arguments}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ClarificationCard({
  question,
  options,
  resolvedSelection,
  onPick,
}: {
  question: string;
  options: { label: string }[];
  resolvedSelection: Extract<ClarificationResolution, { kind: 'option' | 'none' }> | null;
  onPick: (label: string) => void;
}) {
  const locked = resolvedSelection !== null;
  return (
    <div className="max-w-[85%] rounded-2xl border border-amber-300/60 bg-amber-50/60 px-4 py-3 shadow-sm dark:border-amber-400/20 dark:bg-amber-400/5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
          <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 12a1 1 0 110-2 1 1 0 010 2zm1-5a1 1 0 01-2 0V7a1 1 0 112 0v2z" />
        </svg>
        Quick question
      </div>
      <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">{question}</p>
      {resolvedSelection && (
        <div className="mt-2 inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          {resolvedSelection.kind === 'none'
            ? 'Chosen: None of these'
            : `Chosen: ${resolvedSelection.label}`}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt.label}
            type="button"
            disabled={locked}
            onClick={() => onPick(opt.label)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm transition ${
              resolvedSelection?.kind === 'option' && resolvedSelection.label === opt.label
                ? 'border-emerald-400/70 bg-emerald-100 text-emerald-900 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-200'
                : 'border-zinc-200 bg-white text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200'
            } ${
              locked
                ? 'cursor-default opacity-70'
                : 'hover:border-amber-400/60 hover:bg-amber-50 hover:text-amber-900 dark:hover:border-amber-400/40 dark:hover:bg-amber-400/10 dark:hover:text-amber-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
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
