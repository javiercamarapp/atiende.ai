import { Skeleton } from '@/components/ui/skeleton'

export default function InsuranceLoading() {
  return (
    <div>
      {/* Title */}
      <Skeleton className="h-7 w-48 mb-6" />

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 p-4 rounded-lg border border-zinc-200"
          >
            <Skeleton className="h-11 w-11 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-4 w-28" />
            </div>
          </div>
        ))}
      </div>

      {/* Main content area */}
      <div className="rounded-lg border border-zinc-200 p-8">
        <div className="flex flex-col items-center space-y-4">
          <Skeleton className="h-12 w-12 rounded-lg" />
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-4 w-80" />
          <Skeleton className="h-9 w-48 mt-2" />
        </div>
      </div>
    </div>
  )
}
