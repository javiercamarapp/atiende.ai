'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Send, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export default function PlaygroundPage() {
  const [msgs, setMsgs] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [tenant, setTenant] = useState<{ business_type: string; name: string } | null>(null);

  useEffect(() => {
    (async () => {
      const s = createClient();
      const { data: { user } } = await s.auth.getUser();
      const { data } = await s.from('tenants').select('business_type,name').eq('user_id', user!.id).single();
      setTenant(data);
    })();
  }, []);

  const send = async () => {
    if (!input.trim() || loading) return;
    const u = input;
    setInput('');
    setMsgs(p => [...p, { role: 'user', content: u }]);
    setLoading(true);
    try {
      const r = await fetch('/api/onboarding/test-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: u,
          businessType: tenant?.business_type || 'other',
          businessInfo: { name: tenant?.name || '' },
          answers: {},
        }),
      });
      const d = await r.json();
      setMsgs(p => [...p, { role: 'bot', content: d.reply }]);
    } catch {
      setMsgs(p => [...p, { role: 'bot', content: 'Error. Intenta de nuevo.' }]);
    }
    setLoading(false);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-4">Playground — Prueba tu bot</h1>
      <Card className="h-[500px] flex flex-col">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${m.role === 'user' ? 'bg-blue-100' : 'bg-gray-100'}`}>
                <p className="text-[10px] mb-0.5">{m.role === 'user' ? 'Tu' : 'Bot'}</p>
                <p className="text-sm">{m.content}</p>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-2xl px-4 py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            </div>
          )}
        </div>
        <div className="p-3 border-t flex gap-2">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
            placeholder="Escribe como cliente..."
            className="flex-1"
          />
          <Button onClick={send} disabled={loading}>
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </Card>
    </div>
  );
}
