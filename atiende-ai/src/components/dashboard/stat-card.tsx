import { cn } from '@/lib/utils';
import { ArrowUpRight, ArrowDownRight, type LucideIcon } from 'lucide-react';

export function StatCard({
  label,
  value,
  delta,
  subtitle,
  icon: Icon,
  variant = 'default',
}: {
  label: string;
  value: string | number;
  delta?: { value: number; positive: boolean };
  subtitle?: string;
  icon?: LucideIcon;
  variant?: 'default' | 'primary';
}) {
  return (
    <div className="glass-card p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <span className="text-sm text-zinc-600 font-medium">{label}</span>
        {Icon && (
          <div
            className={cn(
              'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
              variant === 'primary'
                ? 'bg-[hsl(var(--brand-blue))] text-white'
                : 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))]',
            )}
          >
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>

      <p className="text-4xl font-semibold tabular-nums text-zinc-900 tracking-tight">
        {value}
      </p>

      {(delta || subtitle) && (
        <div
          className={cn(
            'flex items-center gap-2 text-xs rounded-lg px-3 py-2 -mx-1 -mb-1',
            delta
              ? delta.positive
                ? 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))]'
                : 'bg-red-50 text-red-700'
              : 'bg-zinc-50 text-zinc-600',
          )}
        >
          {delta && (
            <span className="inline-flex items-center gap-0.5 font-medium">
              {delta.positive ? (
                <ArrowUpRight className="w-3 h-3" />
              ) : (
                <ArrowDownRight className="w-3 h-3" />
              )}
              {Math.abs(delta.value)}%
            </span>
          )}
          {subtitle && <span className="truncate">{subtitle}</span>}
        </div>
      )}
    </div>
  );
}
