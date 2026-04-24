'use client';

import { useState } from 'react';

interface Props {
  joinUrl: string;
}

export function TelemedLaunch({ joinUrl }: Props) {
  const [launching, setLaunching] = useState(false);

  const launch = () => {
    setLaunching(true);
    // Abre en la MISMA pestaña para que la experiencia se sienta integrada;
    // si falla el redirect, fallback a target=_blank en 2s.
    window.location.assign(joinUrl);
    setTimeout(() => {
      window.open(joinUrl, '_blank');
    }, 2000);
  };

  return (
    <button
      onClick={launch}
      disabled={launching}
      className="w-full h-12 rounded-xl bg-[hsl(var(--brand-blue))] text-white font-medium text-sm hover:opacity-90 disabled:opacity-60 transition"
    >
      {launching ? 'Abriendo sala…' : 'Entrar a la consulta'}
    </button>
  );
}
