'use client';
import { User, Building2 } from 'lucide-react';

export type AccountType = 'personal' | 'consultorio';

interface AccountTypeSelectorProps {
  onSelect: (type: AccountType) => void;
}

// Primer paso del onboarding: el dueño elige si su agente AI es para él/ella
// solo (personal — un doctor independiente) o para un consultorio con varios
// doctores. La elección define:
//   - account_type que se persiste en tenants (cambia el flujo de billing)
//   - qué preguntas hace Valeria después (consultorio pregunta por equipo,
//     personal omite eso)
//   - qué CTAs ve después (consultorio: "Invitá a tu equipo"; personal: "Conectá
//     tu agenda y arrancá")
export function AccountTypeSelector({ onSelect }: AccountTypeSelectorProps) {
  return (
    <div className="flex flex-col items-center gap-8 animate-element animate-delay-300">
      <div className="text-center">
        <p className="text-sm font-medium text-zinc-900 mb-1">
          ¿Cómo vas a usar atiende.ai?
        </p>
        <p className="text-xs text-zinc-500">
          Esto define cómo armamos tu cuenta y los planes que te mostramos.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-2xl">
        <button
          onClick={() => onSelect('personal')}
          className="flex-1 flex flex-col items-center gap-3 px-8 py-8 rounded-2xl border border-zinc-200 bg-white hover:border-zinc-900 hover:bg-zinc-50 transition-all duration-200 group text-left"
        >
          <User className="w-10 h-10 text-zinc-700 group-hover:text-zinc-900 transition-colors" />
          <div className="text-center">
            <div className="font-semibold text-base text-zinc-900 mb-1">
              Soy un doctor independiente
            </div>
            <div className="text-xs text-zinc-500 leading-relaxed">
              Atiendo mis propias consultas. Una sola persona, una sola
              suscripción.
            </div>
          </div>
        </button>

        <button
          onClick={() => onSelect('consultorio')}
          className="flex-1 flex flex-col items-center gap-3 px-8 py-8 rounded-2xl border border-zinc-200 bg-white hover:border-zinc-900 hover:bg-zinc-50 transition-all duration-200 group text-left"
        >
          <Building2 className="w-10 h-10 text-zinc-700 group-hover:text-zinc-900 transition-colors" />
          <div className="text-center">
            <div className="font-semibold text-base text-zinc-900 mb-1">
              Tengo un consultorio con varios doctores
            </div>
            <div className="text-xs text-zinc-500 leading-relaxed">
              Un agente AI para todo el equipo. Cada doctor con su propio
              login, agenda y suscripción.
            </div>
          </div>
        </button>
      </div>

      <p className="text-[11px] text-zinc-400 max-w-md text-center leading-relaxed">
        Podés cambiar esto después invitando a más doctores desde Configuración.
      </p>
    </div>
  );
}
