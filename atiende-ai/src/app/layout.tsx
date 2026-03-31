import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "atiende.ai",
  description: "Agentes AI de WhatsApp y Voz para PyMEs mexicanas",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
