import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="p-6 space-y-6 animate-in fade-in duration-500">
      <Skeleton className="h-8 w-48" />
      <div className="flex-1 space-y-4">
        <Skeleton className="h-[400px] rounded-xl" />
        <div className="flex gap-2">
          <Skeleton className="h-10 flex-1 rounded-xl" />
          <Skeleton className="h-10 w-20 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
