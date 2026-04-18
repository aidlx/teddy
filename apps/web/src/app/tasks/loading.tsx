export default function Loading() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-6 md:px-6 md:py-10">
      <div className="flex items-center justify-between">
        <div className="h-8 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-900" />
        <div className="h-4 w-14 animate-pulse rounded bg-zinc-100 dark:bg-zinc-950" />
      </div>
      <div className="flex gap-2">
        <div className="h-8 w-44 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-900" />
        <div className="h-8 w-32 animate-pulse rounded-lg bg-zinc-100 ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-900" />
      </div>
      <div className="flex flex-col gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-11 animate-pulse rounded-xl border border-zinc-200 bg-white/60 dark:border-zinc-900 dark:bg-zinc-950/40"
          />
        ))}
      </div>
    </main>
  );
}
