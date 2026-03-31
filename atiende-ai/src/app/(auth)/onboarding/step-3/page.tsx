'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function Step3() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '', phone: '', email: '',
    address: '', city: 'Merida', state: 'Yucatan',
    website: '',
  });
  const [loading, setLoading] = useState(false);

  const handleAutoFill = async () => {
    if (!form.name || !form.city) return;
    setLoading(true);
    try {
      // Llamar a Google Places para auto-llenar
      const res = await fetch('/api/places/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: `${form.name} ${form.city}` }),
      });
      const data = await res.json();
      if (data.result) {
        setForm(prev => ({
          ...prev,
          address: data.result.address || prev.address,
          phone: data.result.phone || prev.phone,
          website: data.result.website || prev.website,
        }));
      }
    } catch (e) {
      console.error('Places error:', e);
    }
    setLoading(false);
  };

  const handleNext = () => {
    localStorage.setItem('ob_business_info', JSON.stringify(form));
    router.push('/onboarding/step-4');
  };

  return (
    <div>
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold">Informacion de tu negocio</h2>
        <p className="text-gray-500 text-sm mt-1">
          Escribe el nombre y buscamos tu info automaticamente
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex gap-2">
          <div className="flex-1">
            <Label>Nombre del negocio *</Label>
            <Input
              value={form.name}
              onChange={e => setForm({...form, name: e.target.value})}
              placeholder="Clinica Dental Sonrisa"
            />
          </div>
          <div className="w-32">
            <Label>Ciudad</Label>
            <Input
              value={form.city}
              onChange={e => setForm({...form, city: e.target.value})}
            />
          </div>
        </div>

        <Button
          variant="outline" className="w-full"
          onClick={handleAutoFill}
          disabled={loading || !form.name}
        >
          {loading ? 'Buscando...' : '🔍 Buscar en Google Maps'}
        </Button>

        <div>
          <Label>Telefono de contacto *</Label>
          <Input
            value={form.phone}
            onChange={e => setForm({...form, phone: e.target.value})}
            placeholder="999 123 4567"
          />
        </div>

        <div>
          <Label>Email *</Label>
          <Input
            type="email"
            value={form.email}
            onChange={e => setForm({...form, email: e.target.value})}
            placeholder="contacto@minegocio.com"
          />
        </div>

        <div>
          <Label>Direccion completa</Label>
          <Input
            value={form.address}
            onChange={e => setForm({...form, address: e.target.value})}
            placeholder="Calle 60 #123, Col. Centro"
          />
        </div>

        <div>
          <Label>Sitio web (opcional)</Label>
          <Input
            value={form.website}
            onChange={e => setForm({...form, website: e.target.value})}
            placeholder="https://www.minegocio.com"
          />
        </div>
      </div>

      <Button
        className="w-full mt-6" size="lg"
        disabled={!form.name || !form.phone || !form.email}
        onClick={handleNext}
      >
        Siguiente →
      </Button>
    </div>
  );
}
