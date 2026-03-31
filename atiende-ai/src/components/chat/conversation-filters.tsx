'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, X, CalendarDays, Filter } from 'lucide-react';

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'active', label: '🤖 Bot activo' },
  { value: 'resolved', label: '✅ Resueltas' },
  { value: 'human_handoff', label: '👤 Humano' },
] as const;

export function ConversationFilters({
  currentSearch,
  currentStatus,
  currentDateFrom,
  currentDateTo,
}: {
  currentSearch: string;
  currentStatus: string;
  currentDateFrom: string;
  currentDateTo: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [searchValue, setSearchValue] = useState(currentSearch);

  const createQueryString = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }
      return params.toString();
    },
    [searchParams]
  );

  const pushParams = useCallback(
    (updates: Record<string, string>) => {
      startTransition(() => {
        const qs = createQueryString(updates);
        router.push(`${pathname}${qs ? `?${qs}` : ''}`);
      });
    },
    [createQueryString, pathname, router]
  );

  const handleSearch = () => {
    pushParams({ q: searchValue });
  };

  const handleClearAll = () => {
    setSearchValue('');
    startTransition(() => {
      router.push(pathname);
    });
  };

  const hasFilters =
    currentSearch || currentStatus !== 'all' || currentDateFrom || currentDateTo;

  const activeFilters: { label: string; key: string }[] = [];
  if (currentSearch) activeFilters.push({ label: `Buscar: "${currentSearch}"`, key: 'q' });
  if (currentStatus !== 'all') {
    const statusLabel = STATUS_OPTIONS.find((s) => s.value === currentStatus)?.label ?? currentStatus;
    activeFilters.push({ label: statusLabel, key: 'status' });
  }
  if (currentDateFrom) activeFilters.push({ label: `Desde: ${currentDateFrom}`, key: 'from' });
  if (currentDateTo) activeFilters.push({ label: `Hasta: ${currentDateTo}`, key: 'to' });

  return (
    <div className="space-y-3">
      {/* Main filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, teléfono..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
            className="pl-10 h-10"
          />
        </div>

        {/* Status filter */}
        <div className="w-full sm:w-48">
          <Select
            value={currentStatus}
            onValueChange={(value) => pushParams({ status: value === 'all' ? '' : value })}
          >
            <SelectTrigger className="h-10">
              <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Date from */}
        <div className="relative w-full sm:w-44">
          <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            type="date"
            value={currentDateFrom}
            onChange={(e) => pushParams({ from: e.target.value })}
            className="pl-10 h-10"
            placeholder="Desde"
          />
        </div>

        {/* Date to */}
        <div className="relative w-full sm:w-44">
          <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            type="date"
            value={currentDateTo}
            onChange={(e) => pushParams({ to: e.target.value })}
            className="pl-10 h-10"
            placeholder="Hasta"
          />
        </div>

        {/* Search button */}
        <Button onClick={handleSearch} className="h-10" disabled={isPending}>
          <Search className="h-4 w-4 mr-2" />
          Buscar
        </Button>
      </div>

      {/* Active filters row */}
      {hasFilters && (
        <div className="flex items-center flex-wrap gap-2">
          <span className="text-xs text-muted-foreground font-medium">
            Filtros activos:
          </span>
          {activeFilters.map((f) => (
            <Badge
              key={f.key}
              variant="secondary"
              className="gap-1 pr-1 cursor-pointer hover:bg-secondary/60"
              onClick={() => {
                if (f.key === 'q') setSearchValue('');
                pushParams({ [f.key]: '' });
              }}
            >
              {f.label}
              <X className="h-3 w-3 ml-1" />
            </Badge>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs text-muted-foreground hover:text-foreground"
            onClick={handleClearAll}
          >
            Limpiar todo
          </Button>
        </div>
      )}
    </div>
  );
}
