export default function Loading() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <div className="h-7 w-24 animate-pulse rounded bg-zinc-800" />
        <div className="h-4 w-12 animate-pulse rounded bg-zinc-900" />
      </div>
      <div className="h-24 animate-pulse rounded-md border border-zinc-800" />
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-md border border-zinc-800" />
        ))}
      </div>
    </main>
  );
}
