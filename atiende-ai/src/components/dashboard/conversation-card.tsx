'use client';

// ─────────────────────────────────────────────────────────────────────────────
// ConversationCard — inbox card mostrando summary + estado + patient
// ─────────────────────────────────────────────────────────────────────────────

import Link from 'next/link';

export interface ConversationCardData {
  id: string;
  customer_name: string | null;
  customer_phone: string;
  summary: string | null;
  assigned_to: string | null;
  last_message_at: string | null;
  status: string | null;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'ahora';
  if (min < 60) return `${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} h`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days} d`;
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

function initials(name: string | null, phone: string): string {
  if (name) {
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || '')
      .join('');
  }
  return phone.slice(-2);
}

export function ConversationCard({ convo }: { convo: ConversationCardData }) {
  const pending = !convo.assigned_to;
  const displayName = convo.customer_name || convo.customer_phone;

  return (
    <Link
      href={`/conversations/${convo.id}`}
      className="stagger-item glass-card block p-4 group hover:border-white/20 transition"
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="shrink-0 w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xs font-medium text-white/80">
          {initials(convo.customer_name, convo.customer_phone)}
        </div>

        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-white truncate">{displayName}</p>
            <span className="text-[10px] uppercase tracking-wider text-white/40 shrink-0 tabular-nums">
              {relativeTime(convo.last_message_at)}
            </span>
          </div>

          {/* Summary or shimmer placeholder */}
          {convo.summary ? (
            <p className="mt-1.5 text-xs text-white/60 line-clamp-2 leading-relaxed">
              {convo.summary}
            </p>
          ) : (
            <div className="mt-1.5 space-y-1.5">
              <div className="shimmer-line h-2 rounded w-11/12" />
              <div className="shimmer-line h-2 rounded w-7/12" />
            </div>
          )}

          {/* Footer badges */}
          <div className="mt-2.5 flex items-center gap-2">
            {pending && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 text-[10px] text-amber-300">
                <span className="w-1 h-1 rounded-full bg-amber-300" />
                pendiente de revisión
              </span>
            )}
            {convo.status === 'human_handoff' && (
              <span className="inline-flex items-center rounded-full bg-red-400/10 border border-red-400/20 px-2 py-0.5 text-[10px] text-red-300">
                handoff humano
              </span>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        .shimmer-line {
          background: linear-gradient(
            90deg,
            rgba(255, 255, 255, 0.04) 0%,
            rgba(255, 255, 255, 0.1) 50%,
            rgba(255, 255, 255, 0.04) 100%
          );
          background-size: 200% 100%;
          animation: shimmer 2.4s ease-in-out infinite;
        }
      `}</style>
    </Link>
  );
}
