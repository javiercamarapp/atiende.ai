import Link from 'next/link';

function SocialLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="w-7 h-7 rounded-full border border-zinc-200 bg-white flex items-center justify-center text-zinc-500 hover:text-[hsl(var(--brand-blue))] hover:border-[hsl(var(--brand-blue))] transition"
    >
      {children}
    </a>
  );
}

export function DashFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="px-6 md:px-8 py-4 flex flex-col md:flex-row items-center justify-between gap-3 text-[11.5px] text-zinc-500 bg-white rounded-bl-3xl">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <span>Copyright © {year} atiende.ai</span>
        <Link href="/settings/privacy" className="hover:text-zinc-900 transition">Privacy Policy</Link>
        <Link href="/settings/terms" className="hover:text-zinc-900 transition">Terms and conditions</Link>
        <Link href="/settings/contact" className="hover:text-zinc-900 transition">Contact</Link>
      </div>
      <div className="flex items-center gap-2.5">
        <SocialLink href="https://facebook.com" label="Facebook">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M13 22v-8h3l.5-4H13V7.5c0-1 .5-2 2-2h2v-3.5S15.5 2 13.5 2C11 2 9 3.5 9 6.5V10H6v4h3v8h4z"/></svg>
        </SocialLink>
        <SocialLink href="https://x.com" label="X">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M18.9 3H22l-7.3 8.4L23 21h-6.8l-5.3-7-6 7H2l7.8-9L1.7 3h7l4.8 6.4L18.9 3zm-2.4 16h1.8L7.6 5H5.6l10.9 14z"/></svg>
        </SocialLink>
        <SocialLink href="https://instagram.com" label="Instagram">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>
        </SocialLink>
        <SocialLink href="https://youtube.com" label="YouTube">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M22 8s-.2-1.5-.8-2.2c-.7-.8-1.6-.8-2-.9C16.5 4.5 12 4.5 12 4.5s-4.5 0-7.2.4c-.4.1-1.3.1-2 .9C2.2 6.5 2 8 2 8s-.2 1.8-.2 3.6v1.7c0 1.8.2 3.6.2 3.6s.2 1.5.8 2.2c.7.8 1.7.8 2.2.9 1.6.2 6.9.3 7.1.3 0 0 4.5 0 7.2-.4.4-.1 1.3-.1 2-.9.6-.7.8-2.2.8-2.2s.2-1.8.2-3.6v-1.7c0-1.8-.2-3.5-.3-3.5zM10 15V9l5.3 3L10 15z"/></svg>
        </SocialLink>
        <SocialLink href="https://linkedin.com" label="LinkedIn">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M4 4h4v4H4V4zm0 6h4v10H4V10zm6 0h4v1.5c.6-1 2-1.8 3.5-1.8 3 0 4.5 1.8 4.5 5V20h-4v-5c0-1.3-.5-2.2-1.8-2.2-1 0-1.7.6-2 1.6-.1.3-.2.7-.2 1.1V20h-4V10z"/></svg>
        </SocialLink>
      </div>
    </footer>
  );
}
