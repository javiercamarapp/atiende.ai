import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="p-6 space-y-6 animate-in fade-in duration-500">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
