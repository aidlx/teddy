export default function Loading() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-6 md:px-6 md:py-10">
      <div className="flex items-center justify-between">
        <div className="h-8 w-36 animate-pulse rounded bg-zinc-200 dark:bg-zinc-900" />
        <div className="h-4 w-14 animate-pulse rounded bg-zinc-100 dark:bg-zinc-950" />
      </div>
      <div className="h-28 animate-pulse rounded-2xl border border-zinc-200 bg-white/60 dark:border-zinc-800 dark:bg-zinc-950/60" />
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-800">
        {Array.from({ length: 42 }).map((_, i) => (
          <div key={i} className="h-22 min-h-[5.5rem] animate-pulse bg-white dark:bg-zinc-950" />
        ))}
      </div>
    </main>
  );
}
