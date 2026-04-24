// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC BOOKING PAGE (Phase 2.A.3) — /book/<slug>
//
// Server component que renderiza la página pública de booking. Carga el
// link por slug en build-side (SSR) para poder servir SEO meta correcto
// (title, OG tags, structured data schema.org MedicalBusiness).
//
// El form es un client component (BookingForm) que maneja los selects
// de fecha/hora llamando al endpoint de availability en el cliente.
// ═════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { BookingForm } from '@/components/public/booking-form';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

async function loadLink(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(slug)) return null;
  const { data: link } = await supabaseAdmin
    .from('public_booking_links')
    .select('id, tenant_id, staff_id, enabled, link_expires_at, heading, subheading, brand_color_hex')
    .eq('slug', slug)
    .maybeSingle();
  if (!link || !link.enabled) return null;
  if (link.link_expires_at && new Date(link.link_expires_at as string) < new Date()) return null;

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('id, name, business_type, city, address, phone, status')
    .eq('id', link.tenant_id)
    .maybeSingle();
  if (!tenant || tenant.status !== 'active') return null;

  const { data: services } = await supabaseAdmin
    .from('services')
    .select('id, name, duration_minutes, price')
    .eq('tenant_id', link.tenant_id)
    .eq('active', true)
    .order('name');

  return { link, tenant, services: services || [] };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await loadLink(slug);
  if (!loaded) {
    return { title: 'Reservar cita' };
  }
  const { tenant, link } = loaded;
  const heading = (link.heading as string) || `Agenda tu cita con ${tenant.name}`;
  const subheading = (link.subheading as string) || `Consultorio ${tenant.business_type || ''} en ${tenant.city || 'México'}`;
  return {
    title: `${tenant.name} — Reservar cita`,
    description: subheading,
    openGraph: {
      title: heading,
      description: subheading,
      type: 'website',
    },
    // No indexable by default para preview deployments; on main prod
    // sí queremos SEO. Si querés control per-tenant agregá un flag en
    // public_booking_links.indexable y devolvelo aquí.
    robots: { index: true, follow: true },
  };
}

export default async function PublicBookingPage({ params }: PageProps) {
  const { slug } = await params;
  const loaded = await loadLink(slug);
  if (!loaded) notFound();

  const { link, tenant, services } = loaded;
  const brand = (link.brand_color_hex as string) || '#2563eb';
  const heading = (link.heading as string) || `Agenda tu cita`;
  const subheading = (link.subheading as string)
    || `${tenant.name}${tenant.city ? ` — ${tenant.city}` : ''}`;

  // Structured data (schema.org MedicalBusiness) para SEO local.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'MedicalBusiness',
    name: tenant.name,
    description: subheading,
    address: tenant.address ? {
      '@type': 'PostalAddress',
      streetAddress: tenant.address,
      addressLocality: tenant.city,
      addressCountry: 'MX',
    } : undefined,
    telephone: tenant.phone,
  };

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="mx-auto max-w-lg px-5 py-10 sm:py-16">
        <header className="mb-8 text-center">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-900">
            {heading}
          </h1>
          <p className="mt-3 text-sm sm:text-base text-zinc-600 leading-relaxed">
            {subheading}
          </p>
        </header>

        <div
          className="rounded-2xl border border-zinc-200 bg-white shadow-sm p-5 sm:p-7"
          style={{ borderTopColor: brand, borderTopWidth: 4 }}
        >
          <BookingForm
            slug={slug}
            services={services as Array<{ id: string; name: string; duration_minutes: number; price: number | null }>}
            brandColor={brand}
          />
        </div>

        <footer className="mt-8 text-center text-[11px] text-zinc-400">
          Impulsado por atiende.ai · Tus datos se usan solo para agendar y contactar.
        </footer>
      </div>
    </div>
  );
}
