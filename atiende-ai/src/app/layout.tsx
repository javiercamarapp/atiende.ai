import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';

export const metadata: Metadata = {
  title: 'useatiende.ai — Asistente AI para tu negocio',
  description: 'Agentes de WhatsApp y voz AI para negocios mexicanos.',
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
