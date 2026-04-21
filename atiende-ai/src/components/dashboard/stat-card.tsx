import { cn } from '@/lib/utils';
import { ArrowUpRight, ArrowDownRight, MoreHorizontal, type LucideIcon } from 'lucide-react';

export function StatCard({
  label,
  value,
  delta,
  description,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  delta?: { value: number; positive: boolean };
  description?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="glass-card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {Icon && (
            <div className="w-8 h-8 rounded-lg bg-[hsl(var(--brand-blue-soft))] flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4 text-[hsl(var(--brand-blue))]" />
            </div>
          )}
          <span className="text-sm text-zinc-600 font-medium">{label}</span>
        </div>
        <button className="text-zinc-400 hover:text-zinc-600 transition">
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-end justify-between gap-3">
        <p className="text-3xl font-semibold tabular-nums text-zinc-900 tracking-tight leading-none">
          {value}
        </p>
        {delta && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums rounded-md px-1.5 py-0.5',
              delta.positive
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-red-50 text-red-600',
            )}
          >
            {delta.positive ? (
              <ArrowUpRight className="w-3 h-3" />
            ) : (
              <ArrowDownRight className="w-3 h-3" />
            )}
            {delta.value}%
          </span>
        )}
      </div>

      {description && (
        <p className="text-xs text-zinc-500 leading-snug">{description}</p>
      )}
    </div>
  );
}
