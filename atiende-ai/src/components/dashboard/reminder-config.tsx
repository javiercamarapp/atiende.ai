'use client';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Bell, Save } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

interface ReminderConfigProps {
  tenantId: string;
  currentConfig?: { reminder_24h: boolean; reminder_12h: boolean; reminder_1h: boolean; reminder_30m: boolean; use_buttons: boolean };
}

export function ReminderConfig({ tenantId, currentConfig }: ReminderConfigProps) {
  const [config, setConfig] = useState(currentConfig || {
    reminder_24h: true, reminder_12h: false, reminder_1h: true, reminder_30m: false, use_buttons: true,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const supabase = createClient();
      await supabase.from('tenants').update({ config: { ...config } }).eq('id', tenantId);
      toast.success('Recordatorios actualizados');
    } catch { toast.error('Error al guardar'); }
    finally { setSaving(false); }
  };

  const toggles = [
    { key: 'reminder_24h', label: '24 horas antes' },
    { key: 'reminder_12h', label: '12 horas antes' },
    { key: 'reminder_1h', label: '1 hora antes' },
    { key: 'reminder_30m', label: '30 minutos antes' },
    { key: 'use_buttons', label: 'Usar botones (Confirmar/Cancelar)' },
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Bell className="w-5 h-5" /> Configurar Recordatorios</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {toggles.map(t => (
          <div key={t.key} className="flex items-center justify-between">
            <span className="text-sm text-zinc-700">{t.label}</span>
            <Switch checked={config[t.key]} onCheckedChange={(v) => setConfig(prev => ({ ...prev, [t.key]: v }))} />
          </div>
        ))}
        <Button onClick={save} disabled={saving} className="w-full bg-emerald-600 hover:bg-emerald-700">
          <Save className="w-4 h-4 mr-1" /> {saving ? 'Guardando...' : 'Guardar configuración'}
        </Button>
      </CardContent>
    </Card>
  );
}
