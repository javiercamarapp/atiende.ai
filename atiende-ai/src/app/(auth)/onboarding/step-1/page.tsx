'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const SECTIONS = [
  {
    id: 'salud',
    title: 'Salud & Bienestar',
    subtitle: 'Consultorios y especialistas',
    icon: '🏥',
    color: { bg: '#E8F8F1', border: '#34C78A', cardBg: '#F0FBF7', shadow: 'rgba(52,199,138,.18)', text: '#1A9362', badge: '#34C78A' },
    cols: 2,
    cards: [
      { key: 'dental', emoji: '🦷', label: 'Dental' },
      { key: 'medical', emoji: '🏥', label: 'Médico' },
      { key: 'nutritionist', emoji: '🥗', label: 'Nutrióloga' },
      { key: 'psychologist', emoji: '🧠', label: 'Psicólogo' },
      { key: 'dermatologist', emoji: '✨', label: 'Dermatólogo' },
      { key: 'gynecologist', emoji: '👶', label: 'Ginecólogo' },
      { key: 'pediatrician', emoji: '🩺', label: 'Pediatra' },
      { key: 'ophthalmologist', emoji: '👁️', label: 'Oftalmólogo' },
      { key: 'pharmacy', emoji: '💊', label: 'Farmacia' },
      { key: 'veterinary', emoji: '🐾', label: 'Veterinaria' },
    ],
  },
  {
    id: 'food',
    title: 'Gastronomía',
    subtitle: 'Restaurants, bares y más',
    icon: '🍽️',
    color: { bg: '#FEF3E8', border: '#F28C2B', cardBg: '#FEF7EE', shadow: 'rgba(242,140,43,.18)', text: '#D4700A', badge: '#F28C2B' },
    cols: 3,
    cards: [
      { key: 'restaurant', emoji: '🍽️', label: 'Restaurante' },
      { key: 'taqueria', emoji: '🌮', label: 'Taquería' },
      { key: 'cafe', emoji: '☕', label: 'Cafetería' },
      { key: 'bakery', emoji: '🥐', label: 'Panadería' },
      { key: 'bar', emoji: '🍺', label: 'Bar / Cantina' },
      { key: 'food_truck', emoji: '🚐', label: 'Food Truck' },
    ],
  },
  {
    id: 'beauty',
    title: 'Belleza & Lifestyle',
    subtitle: 'Cuidado personal y fitness',
    icon: '💅',
    color: { bg: '#FEE9F5', border: '#E040A0', cardBg: '#FEF0F8', shadow: 'rgba(224,64,160,.18)', text: '#B8257A', badge: '#E040A0' },
    cols: 3,
    cards: [
      { key: 'salon', emoji: '💇', label: 'Salón de belleza' },
      { key: 'barbershop', emoji: '💈', label: 'Barbería' },
      { key: 'spa', emoji: '🧖', label: 'Spa' },
      { key: 'gym', emoji: '💪', label: 'Gimnasio' },
      { key: 'nail_salon', emoji: '💅', label: 'Nail Salon' },
      { key: 'aesthetics', emoji: '🪞', label: 'Estética' },
    ],
  },
  {
    id: 'pro',
    title: 'Servicios Profesionales',
    subtitle: 'Legal, digital y educación',
    icon: '💼',
    color: { bg: '#EAF0FE', border: '#4C7EF0', cardBg: '#F2F6FF', shadow: 'rgba(76,126,240,.18)', text: '#2A5FCC', badge: '#4C7EF0' },
    cols: 3,
    cards: [
      { key: 'accountant', emoji: '📊', label: 'Contable / Legal' },
      { key: 'insurance', emoji: '🛡️', label: 'Seguros' },
      { key: 'mechanic', emoji: '🔧', label: 'Taller mecánico' },
      { key: 'school', emoji: '🎓', label: 'Escuela' },
      { key: 'agency', emoji: '💻', label: 'Agencia Digital' },
      { key: 'photographer', emoji: '📸', label: 'Fotógrafo' },
    ],
  },
  {
    id: 'hospitality',
    title: 'Hospedaje & Turismo',
    subtitle: 'Hotel, boutique y más',
    icon: '🛎️',
    color: { bg: '#FFF4E8', border: '#F5A623', cardBg: '#FFFAF0', shadow: 'rgba(245,166,35,.18)', text: '#B87A0A', badge: '#F5A623' },
    cols: 3,
    cards: [
      { key: 'hotel', emoji: '🏨', label: 'Hotel' },
      { key: 'boutique_hotel', emoji: '🛎️', label: 'Boutique Hotel' },
      { key: 'motel', emoji: '🏩', label: 'Motel' },
      { key: 'glamping', emoji: '🏕️', label: 'Glamping' },
      { key: 'hostal', emoji: '🌅', label: 'B&B / Hostal' },
      { key: 'resort', emoji: '🏖️', label: 'Resort' },
    ],
  },
  {
    id: 'retail',
    title: 'Comercios & Retail',
    subtitle: 'Tiendas y puntos de venta',
    icon: '🛍️',
    color: { bg: '#EDE9FE', border: '#8B5CF6', cardBg: '#F5F2FF', shadow: 'rgba(139,92,246,.18)', text: '#6D3FCC', badge: '#8B5CF6' },
    cols: 3,
    cards: [
      { key: 'florist', emoji: '💐', label: 'Florerías' },
      { key: 'clothing', emoji: '👗', label: 'Tienda de ropa' },
      { key: 'stationery', emoji: '📝', label: 'Papelería' },
      { key: 'hardware', emoji: '🔨', label: 'Ferretería' },
      { key: 'grocery', emoji: '🛒', label: 'Abarrotes' },
      { key: 'bookstore', emoji: '📚', label: 'Librería' },
      { key: 'jewelry', emoji: '💎', label: 'Joyería' },
      { key: 'toy_store', emoji: '🧸', label: 'Juguetería' },
      { key: 'shoe_store', emoji: '👟', label: 'Zapatería' },
    ],
  },
];

export default function Step1() {
  const [selected, setSelected] = useState('');
  const [selectedLabel, setSelectedLabel] = useState('');
  const router = useRouter();

  useEffect(() => {
    const saved = localStorage.getItem('ob_business_type');
    if (saved) {
      setSelected(saved);
      for (const s of SECTIONS) {
        const card = s.cards.find(c => c.key === saved);
        if (card) { setSelectedLabel(card.label); break; }
      }
    }
  }, []);

  const handleSelect = (key: string, label: string) => {
    if (selected === key) {
      setSelected('');
      setSelectedLabel('');
    } else {
      setSelected(key);
      setSelectedLabel(label);
    }
  };

  const handleNext = () => {
    if (!selected) return;
    localStorage.setItem('ob_business_type', selected);
    router.push('/onboarding/step-2');
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', padding: '14px 24px 12px', gap: '10px', background: '#FFFFFF', fontFamily: "'Plus Jakarta Sans', sans-serif", animation: 'fadeIn .5s ease .1s forwards', opacity: 0 }}>
      <style>{`
        @keyframes fadeIn { to { opacity: 1 } }
        @keyframes sIn { to { opacity: 1; transform: translateY(0) } }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontSize: '28px', fontWeight: 700, color: '#1A1D2E', fontFamily: 'Georgia, serif', letterSpacing: '-0.5px' }}>atiende.ai</span>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#1A1D2E' }}>¿Qué tipo de negocio tienes?</h2>
          <span style={{ fontSize: '11px', color: '#9599B3' }}>Esto personaliza completamente tu asistente AI</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <div style={{ width: '20px', height: '6px', borderRadius: '3px', background: '#1A1D2E' }} />
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#D8DAE8' }} />
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#D8DAE8' }} />
        </div>
      </div>

      {/* Grid: 3 cols × 3 rows */}
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr 1fr 1fr', gap: '9px' }}>
        {SECTIONS.map((section, si) => {
          const gridStyles: Record<string, React.CSSProperties> = {
            salud: { gridColumn: '1', gridRow: '1 / 4' },
            food: { gridColumn: '2', gridRow: '1' },
            beauty: { gridColumn: '2', gridRow: '2' },
            pro: { gridColumn: '2', gridRow: '3' },
            hospitality: { gridColumn: '3', gridRow: '1' },
            retail: { gridColumn: '3', gridRow: '2 / 4' },
          };

          const cardGridStyles: Record<string, React.CSSProperties> = {
            salud: { gridTemplateColumns: 'repeat(2, 1fr)', gridTemplateRows: 'repeat(5, 1fr)' },
            food: { gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(2, 1fr)' },
            beauty: { gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(2, 1fr)' },
            pro: { gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(2, 1fr)' },
            hospitality: { gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(2, 1fr)' },
            retail: { gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)' },
          };

          return (
            <div
              key={section.id}
              style={{
                ...gridStyles[section.id],
                background: 'white',
                borderRadius: '13px',
                padding: '10px 11px 11px',
                boxShadow: '0 2px 10px rgba(0,0,0,.05)',
                display: 'flex',
                flexDirection: 'column',
                gap: '7px',
                minHeight: 0,
                opacity: 0,
                transform: 'translateY(10px)',
                animation: `sIn .45s cubic-bezier(.22,1,.36,1) ${0.16 + si * 0.07}s forwards`,
              }}
            >
              {/* Section header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', paddingBottom: '7px', borderBottom: '1px solid #F0F2F8', flexShrink: 0 }}>
                <div style={{ width: '24px', height: '24px', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', background: section.color.bg }}>
                  {section.icon}
                </div>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#1A1D2E' }}>{section.title}</div>
                  <div style={{ fontSize: '9px', color: '#9599B3', marginTop: '1px' }}>{section.subtitle}</div>
                </div>
              </div>

              {/* Cards grid */}
              <div style={{ flex: 1, display: 'grid', gap: '5px', minHeight: 0, ...cardGridStyles[section.id] }}>
                {section.cards.map(card => {
                  const isSelected = selected === card.key;
                  return (
                    <div
                      key={card.key}
                      onClick={() => handleSelect(card.key, card.label)}
                      style={{
                        borderRadius: '9px',
                        background: isSelected ? section.color.cardBg : '#F8F9FC',
                        border: `1.5px solid ${isSelected ? section.color.border : '#EDEEF5'}`,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '3px',
                        cursor: 'pointer',
                        minHeight: 0,
                        position: 'relative',
                        overflow: 'hidden',
                        transition: 'all .2s cubic-bezier(.22,1,.36,1)',
                        boxShadow: isSelected ? `0 4px 12px ${section.color.shadow}` : 'none',
                      }}
                    >
                      {/* Check badge */}
                      <div style={{
                        position: 'absolute', top: '4px', right: '4px',
                        width: '13px', height: '13px', borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '7px', fontWeight: 700, color: 'white',
                        background: section.color.badge,
                        opacity: isSelected ? 1 : 0,
                        transform: isSelected ? 'scale(1)' : 'scale(.5)',
                        transition: 'all .22s cubic-bezier(.34,1.56,.64,1)',
                      }}>✓</div>
                      <span style={{ fontSize: '18px', lineHeight: 1, transition: 'transform .2s cubic-bezier(.34,1.56,.64,1)' }}>{card.emoji}</span>
                      <span style={{
                        fontSize: '8.5px', fontWeight: 500, textAlign: 'center',
                        color: isSelected ? section.color.text : '#4A4E6A',
                        lineHeight: 1.2, padding: '0 3px', transition: 'color .2s ease',
                      }}>{card.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: '12px',
          color: selected ? '#1A9362' : '#9599B3',
          fontWeight: selected ? 500 : 400,
          transition: 'all .3s ease',
        }}>
          {selected ? `✓ ${selectedLabel}` : 'Selecciona tu tipo de negocio'}
        </span>
        <button
          onClick={handleNext}
          style={{
            background: '#1A1D2E',
            color: 'white',
            fontSize: '13px',
            fontWeight: 600,
            padding: '10px 28px',
            borderRadius: '50px',
            border: 'none',
            cursor: selected ? 'pointer' : 'not-allowed',
            opacity: selected ? 1 : 0.5,
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
            transition: 'all .22s cubic-bezier(.22,1,.36,1)',
          }}
        >
          Siguiente <span style={{ transition: 'transform .22s cubic-bezier(.34,1.56,.64,1)' }}>→</span>
        </button>
      </div>
    </div>
  );
}
