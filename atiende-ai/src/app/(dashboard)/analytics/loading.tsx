import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Skeleton className="h-7 w-48" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}
