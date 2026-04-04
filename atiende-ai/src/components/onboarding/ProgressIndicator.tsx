'use client';

interface ProgressIndicatorProps {
  current: number;
  total: number;
  verticalName: string;
}

export function ProgressIndicator({ current, total, verticalName }: ProgressIndicatorProps) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <div className="flex-1 h-1 bg-zinc-100 rounded-full overflow-hidden max-w-[200px]">
        <div
          className="h-full bg-zinc-900 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="whitespace-nowrap">
        {current}/{total} — {verticalName}
      </span>
    </div>
  );
}
