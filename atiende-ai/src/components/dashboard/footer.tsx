import Link from 'next/link';

function SocialLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="w-5 h-5 flex items-center justify-center text-zinc-400 hover:text-[hsl(var(--brand-blue))] transition"
    >
      {children}
    </a>
  );
}

export function DashFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="h-8 px-6 md:px-8 flex items-center justify-between gap-3 text-[10.5px] text-zinc-400 bg-white">
      <div className="flex items-center gap-x-3">
        <span>© {year} atiende.ai</span>
        <Link href="/settings/privacy" className="hover:text-zinc-700 transition">Privacidad</Link>
        <Link href="/settings/terms" className="hover:text-zinc-700 transition">Términos</Link>
        <Link href="/settings/contact" className="hover:text-zinc-700 transition">Contacto</Link>
      </div>
      <div className="flex items-center gap-1.5">
        <SocialLink href="https://facebook.com" label="Facebook">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><path d="M13 22v-8h3l.5-4H13V7.5c0-1 .5-2 2-2h2v-3.5S15.5 2 13.5 2C11 2 9 3.5 9 6.5V10H6v4h3v8h4z"/></svg>
        </SocialLink>
        <SocialLink href="https://x.com" label="X">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><path d="M18.9 3H22l-7.3 8.4L23 21h-6.8l-5.3-7-6 7H2l7.8-9L1.7 3h7l4.8 6.4L18.9 3zm-2.4 16h1.8L7.6 5H5.6l10.9 14z"/></svg>
        </SocialLink>
        <SocialLink href="https://instagram.com" label="Instagram">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>
        </SocialLink>
        <SocialLink href="https://tiktok.com" label="TikTok">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><path d="M19.3 6.7a5.6 5.6 0 0 1-3.4-1.2 5.6 5.6 0 0 1-2.1-3.5h-3.3v13.4a2.7 2.7 0 1 1-2-2.6V9.4a6 6 0 1 0 5.3 6V9.1a8.9 8.9 0 0 0 5.5 1.9V7.7a5.5 5.5 0 0 1 0-1z"/></svg>
        </SocialLink>
        <SocialLink href="https://www.linkedin.com/company/atiende-ai/?viewAsMember=true" label="LinkedIn">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><path d="M4 4h4v4H4V4zm0 6h4v10H4V10zm6 0h4v1.5c.6-1 2-1.8 3.5-1.8 3 0 4.5 1.8 4.5 5V20h-4v-5c0-1.3-.5-2.2-1.8-2.2-1 0-1.7.6-2 1.6-.1.3-.2.7-.2 1.1V20h-4V10z"/></svg>
        </SocialLink>
      </div>
    </footer>
  );
}
