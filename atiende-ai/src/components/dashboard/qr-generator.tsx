'use client';
import { useState, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Download, QrCode } from 'lucide-react';

interface QRGeneratorProps {
  phone: string;
  businessName: string;
}

export function QRGenerator({ phone, businessName }: QRGeneratorProps) {
  const [size, setSize] = useState(256);
  const ref = useRef<HTMLDivElement>(null);
  const waUrl = `https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=Hola%2C%20me%20interesa%20saber%20más`;

  const download = () => {
    const svg = ref.current?.querySelector('svg');
    if (!svg) return;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const data = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      ctx?.drawImage(img, 0, 0);
      const a = document.createElement('a');
      a.download = `qr-${businessName.toLowerCase().replace(/\s/g, '-')}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(data);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><QrCode className="w-5 h-5" /> Código QR de WhatsApp</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        <div ref={ref} className="bg-white p-4 rounded-xl border">
          <QRCodeSVG value={waUrl} size={size} level="M" includeMargin />
        </div>
        <p className="text-sm text-zinc-500 text-center">Imprime este QR en tarjetas, flyers o facturas.<br/>Los clientes escanean → abren WhatsApp directo.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setSize(s => s === 256 ? 512 : 256)}>
            {size === 256 ? 'Grande' : 'Normal'}
          </Button>
          <Button size="sm" onClick={download} className="bg-zinc-900 text-white hover:bg-zinc-800">
            <Download className="w-4 h-4 mr-1" /> Descargar PNG
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
