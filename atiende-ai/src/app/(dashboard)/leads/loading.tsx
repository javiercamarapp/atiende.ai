import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="p-6 space-y-6 animate-in fade-in duration-500">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-6 w-24" />
            {[1, 2, 3].map((j) => (
              <Skeleton key={j} className="h-20 rounded-xl" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
