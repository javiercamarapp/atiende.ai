import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-500">
      <Skeleton className="h-10 w-40" />
      <div className="rounded-2xl border border-zinc-100 bg-white p-6 space-y-4">
        <Skeleton className="h-14 w-14 rounded-full mx-auto" />
        <Skeleton className="h-5 w-48 mx-auto" />
        <Skeleton className="h-2 w-full rounded-full" />
      </div>
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
