import { CfdiConfigForm } from '@/components/dashboard/cfdi-config-form';

export const dynamic = 'force-dynamic';

export default function CfdiSettingsPage() {
  return (
    <div className="max-w-2xl mx-auto p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900">Facturación CFDI</h1>
        <p className="text-sm text-zinc-500 mt-1 leading-relaxed">
          Configurá tu integración con{' '}
          <a
            href="https://www.facturapi.io"
            target="_blank"
            rel="noreferrer noopener"
            className="text-[hsl(var(--brand-blue))] underline"
          >
            Facturapi
          </a>
          {' '}para emitir CFDI 4.0 automáticamente al recibir pagos. Tu API key se guarda
          encriptada server-side y nunca es visible en el navegador.
        </p>
      </header>
      <CfdiConfigForm />
    </div>
  );
}
