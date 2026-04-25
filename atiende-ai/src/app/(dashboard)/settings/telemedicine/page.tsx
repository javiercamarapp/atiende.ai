import { TelemedConfigForm } from '@/components/dashboard/telemed-config-form';

export const dynamic = 'force-dynamic';

export default function TelemedSettingsPage() {
  return (
    <div className="max-w-2xl mx-auto p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900">Telemedicina</h1>
        <p className="text-sm text-zinc-500 mt-1 leading-relaxed">
          Activá videollamadas en tu consultorio. El bot puede ofrecerlas como
          alternativa a citas presenciales y enviar el link automáticamente
          15 minutos antes de la cita.
        </p>
      </header>
      <TelemedConfigForm />
    </div>
  );
}
