'use client';
import { Lightbulb } from 'lucide-react';

interface InsightCardProps {
  text: string;
}

export function InsightCard({ text }: InsightCardProps) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-zinc-50 border border-zinc-100 text-sm text-zinc-600 max-w-lg">
      <Lightbulb className="w-4 h-4 mt-0.5 shrink-0 text-zinc-400" />
      <span>{text}</span>
    </div>
  );
}
