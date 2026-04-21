import { cn } from '@/lib/utils';

type AgendaItem = {
  id: string;
  title: string;
  tag?: string;
  timeRange?: string;
  day: number;
  weekday: string;
};

export function AgendaWidget({ items }: { items: AgendaItem[] }) {
  if (items.length === 0) {
    return (
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-zinc-900">Agenda</h3>
        </div>
        <p className="text-xs text-zinc-500 text-center py-6">Sin eventos próximos</p>
      </div>
    );
  }

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-zinc-900">Agenda</h3>
        <button className="text-zinc-400 hover:text-zinc-900 transition">
          <span className="text-xs">•••</span>
        </button>
      </div>

      <div className="space-y-2">
        {items.map((item, idx) => (
          <div
            key={item.id}
            className={cn(
              'flex items-start gap-3 rounded-xl p-3 transition',
              idx === 0
                ? 'bg-[hsl(var(--brand-blue-soft))]'
                : 'bg-zinc-50 hover:bg-[hsl(var(--brand-blue-soft))]',
            )}
          >
            <div className="shrink-0 text-center w-10">
              <p className="text-xl font-semibold tabular-nums text-zinc-900 leading-none">
                {item.day}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 mt-1">
                {item.weekday}
              </p>
            </div>
            <div className="flex-1 min-w-0">
              {item.tag && (
                <span className="inline-block text-[10px] font-medium text-[hsl(var(--brand-blue))] bg-white/80 rounded-md px-2 py-0.5 mb-1">
                  {item.tag}
                </span>
              )}
              <p className="text-sm font-medium text-zinc-900 truncate">{item.title}</p>
              {item.timeRange && (
                <p className="text-[11px] text-zinc-500 mt-0.5 tabular-nums">
                  {item.timeRange}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
