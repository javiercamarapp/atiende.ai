// ═════════════════════════════════════════════════════════════════════════════
// /settings/privacy — Resumen de privacidad y manejo de datos del consultorio
// ═════════════════════════════════════════════════════════════════════════════

import { ShieldCheck, Database, Lock, FileText, Trash2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-900 flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-[hsl(var(--brand-blue))]" />
          Privacidad y manejo de datos
        </h1>
        <p className="text-sm text-zinc-500 mt-1 leading-relaxed">
          Cómo atiende.ai protege la información de tus pacientes. Cumplimos con
          LFPDPPP (Ley Federal de Protección de Datos Personales) y NOM-024.
        </p>
      </header>

      <Section
        icon={Lock}
        title="Cifrado de PII"
        body="Nombres, teléfonos, direcciones y notas clínicas se cifran en reposo con AES-256-GCM. La clave nunca sale del servidor. En caso de filtración de la base de datos, los datos personales son inútiles sin la clave."
      />

      <Section
        icon={Database}
        title="Aislamiento por consultorio"
        body="Toda tu información (pacientes, citas, conversaciones) está aislada a nivel base de datos por Row Level Security (RLS). Es físicamente imposible que otro consultorio acceda a tus datos, incluso si nuestro código tuviera un bug."
      />

      <Section
        icon={FileText}
        title="Lo que NO compartimos"
        body="Nunca vendemos ni compartimos datos de pacientes con terceros para marketing. Los proveedores que usamos (OpenRouter, Supabase, Stripe, WhatsApp Business API) son sub-procesadores con contratos de confidencialidad. WhatsApp Business API ya está aprobada por Meta para uso médico."
      />

      <Section
        icon={Trash2}
        title="Retención y borrado"
        body="Los mensajes de WhatsApp se conservan 12 meses para historial clínico. Las notas del doctor se conservan según NOM-004 (mínimo 5 años). Si das de baja tu cuenta, podés solicitar el borrado completo escribiendo a soporte — borramos en 30 días o anonimizamos si la ley exige conservación clínica."
      />

      <Section
        icon={ShieldCheck}
        title="Derechos ARCO del paciente"
        body="Cualquier paciente puede solicitar Acceso, Rectificación, Cancelación u Oposición a sus datos. El paciente puede pedirlo directamente al bot ('quiero ver mi expediente', 'borren mis datos') y se genera un ticket. También podés gestionarlo desde /contacts → paciente → Acciones → Exportar / Borrar."
      />

      <p className="text-[11px] text-zinc-400 text-center mt-6 leading-relaxed">
        Esta es una guía operativa. Para el aviso de privacidad legal completo,
        contactá a soporte. atiende.ai NO sustituye el aviso de privacidad propio
        que cada consultorio debe entregar al paciente — somos infraestructura.
      </p>
    </div>
  );
}

function Section({
  icon: Icon, title, body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <section className="bg-white border border-zinc-100 rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))] flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          <p className="text-[13px] text-zinc-600 mt-1 leading-relaxed">{body}</p>
        </div>
      </div>
    </section>
  );
}
