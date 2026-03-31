'use client';
import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, Check, Clock, Store, Building2 } from 'lucide-react';

interface OxxoReferenceProps {
  reference?: string | null;
  clabe?: string | null;
  amount?: string | null;
  expiresAt?: string | null;
}

function useCountdown(expiresAt: string | null | undefined) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    if (!expiresAt) return;

    const update = () => {
      const now = Date.now();
      const exp = new Date(expiresAt).getTime();
      const diff = exp - now;
      if (diff <= 0) {
        setRemaining('Expirado');
        return;
      }
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      setRemaining(
        `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      );
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  return remaining;
}

export function OxxoReference({ reference, clabe, amount, expiresAt }: OxxoReferenceProps) {
  const [copied, setCopied] = useState(false);
  const countdown = useCountdown(expiresAt);
  const isOxxo = !!reference;
  const isSPEI = !!clabe;
  const displayValue = reference || clabe || '';

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(displayValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = displayValue;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [displayValue]);

  if (!isOxxo && !isSPEI) return null;

  return (
    <Card className="max-w-md mx-auto">
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center gap-2">
          {isOxxo ? (
            <Store className="w-6 h-6 text-yellow-600" />
          ) : (
            <Building2 className="w-6 h-6 text-blue-600" />
          )}
          <h3 className="text-lg font-bold">
            {isOxxo ? 'Pago en OXXO' : 'Transferencia SPEI'}
          </h3>
        </div>

        {amount && (
          <div>
            <p className="text-sm text-gray-500">Monto a pagar</p>
            <p className="text-2xl font-bold">${amount} MXN</p>
          </div>
        )}

        <div>
          <p className="text-sm text-gray-500 mb-1">
            {isOxxo ? 'Numero de referencia' : 'CLABE interbancaria'}
          </p>
          <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-3 border">
            <code className="text-lg font-mono font-bold tracking-wider flex-1 text-center">
              {displayValue}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCopy}
              className="shrink-0"
            >
              {copied ? (
                <><Check className="w-4 h-4 mr-1" /> Copiado</>
              ) : (
                <><Copy className="w-4 h-4 mr-1" /> Copiar referencia</>
              )}
            </Button>
          </div>
        </div>

        {isOxxo && (
          <div className="text-sm text-gray-500 space-y-1">
            <p>1. Acude a cualquier tienda OXXO</p>
            <p>2. Indica que deseas hacer un pago de servicios</p>
            <p>3. Proporciona el numero de referencia</p>
            <p>4. Realiza el pago en efectivo</p>
          </div>
        )}

        {isSPEI && (
          <div className="text-sm text-gray-500 space-y-1">
            <p>1. Ingresa a tu banca en linea o app de tu banco</p>
            <p>2. Realiza una transferencia SPEI a la CLABE indicada</p>
            <p>3. Ingresa el monto exacto</p>
          </div>
        )}

        {expiresAt && countdown && (
          <div className="flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-amber-500" />
            {countdown === 'Expirado' ? (
              <Badge variant="destructive">Referencia expirada</Badge>
            ) : (
              <span className="text-gray-600">
                Expira en: <span className="font-mono font-medium">{countdown}</span>
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
