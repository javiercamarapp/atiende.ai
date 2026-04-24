import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';

export const metadata: Metadata = {
  title: 'useatiende.ai — Asistente AI para tu negocio',
  description: 'Agentes de WhatsApp y voz AI para negocios mexicanos.',
  // Móviles (especialmente iOS Safari) auto-linkifican secuencias de
  // dígitos que parecen teléfonos, convirtiéndolas en enlaces tel://
  // azules subrayados. En el dashboard (listas de pacientes, modals de
  // reagendar/cancelar) eso se ve como un bug cuando el dueño no puso
  // nombre. Deshabilitamos la detección a nivel documento.
  formatDetection: { telephone: false, date: false, address: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
