'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const TYPES = [
  { key: 'dental', icon: '🦷', label: 'Consultorio dental' },
  { key: 'medical', icon: '🏥', label: 'Consultorio medico' },
  { key: 'nutritionist', icon: '🥗', label: 'Nutriologa' },
  { key: 'psychologist', icon: '🧠', label: 'Psicologo' },
  { key: 'dermatologist', icon: '✨', label: 'Dermatologo' },
  { key: 'gynecologist', icon: '👩‍⚕️', label: 'Ginecologo' },
  { key: 'pediatrician', icon: '👶', label: 'Pediatra' },
  { key: 'ophthalmologist', icon: '👁', label: 'Oftalmologo' },
  { key: 'restaurant', icon: '🍽', label: 'Restaurante' },
  { key: 'taqueria', icon: '🌮', label: 'Taqueria' },
  { key: 'cafe', icon: '☕', label: 'Cafeteria' },
  { key: 'hotel', icon: '🏨', label: 'Hotel' },
  { key: 'real_estate', icon: '🏠', label: 'Inmobiliaria' },
  { key: 'salon', icon: '💇‍♀️', label: 'Salon de belleza' },
  { key: 'barbershop', icon: '💈', label: 'Barberia' },
  { key: 'spa', icon: '🧖', label: 'Spa' },
  { key: 'gym', icon: '💪', label: 'Gimnasio' },
  { key: 'veterinary', icon: '🐾', label: 'Veterinaria' },
  { key: 'pharmacy', icon: '💊', label: 'Farmacia' },
  { key: 'school', icon: '🎓', label: 'Escuela' },
  { key: 'insurance', icon: '🛡', label: 'Seguros' },
  { key: 'mechanic', icon: '🔧', label: 'Taller mecanico' },
  { key: 'accountant', icon: '📊', label: 'Contable/Legal' },
  { key: 'florist', icon: '💐', label: 'Floreria' },
  { key: 'optics', icon: '👓', label: 'Optica' },
];

export default function Step1() {
  const [selected, setSelected] = useState('');
  const router = useRouter();

  useEffect(() => {
    const saved = localStorage.getItem('ob_business_type');
    if (saved) setSelected(saved);
  }, []);

  return (
    <div>
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold">Que tipo de negocio tienes?</h2>
        <p className="text-gray-500 text-sm mt-1">
          Esto personaliza completamente tu asistente AI
        </p>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {TYPES.map(t => (
          <Card
            key={t.key}
            onClick={() => setSelected(t.key)}
            className={`p-2 cursor-pointer text-center transition-all
              hover:shadow-md
              ${selected === t.key
                ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500 shadow-md'
                : 'hover:border-gray-300'}`}
          >
            <div className="text-2xl">{t.icon}</div>
            <div className="text-[10px] font-medium mt-1 leading-tight">
              {t.label}
            </div>
          </Card>
        ))}
      </div>

      <Button
        className="w-full mt-6"
        size="lg"
        disabled={!selected}
        onClick={() => {
          localStorage.setItem('ob_business_type', selected);
          router.push('/onboarding/step-2');
        }}
      >
        Siguiente →
      </Button>
    </div>
  );
}
