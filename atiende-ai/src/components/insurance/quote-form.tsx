'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FileText } from 'lucide-react'
import {
  INSURANCE_LINE_LABELS,
  COVERAGE_LABELS,
} from '@/lib/insurance/constants'
import type { InsuranceLine, CoverageType } from '@/lib/insurance/types'
import { QuoteProgress } from './quote-progress'

const INSURANCE_LINES = Object.entries(INSURANCE_LINE_LABELS) as [
  InsuranceLine,
  string,
][]

const COVERAGE_TYPES = Object.entries(COVERAGE_LABELS) as [
  CoverageType,
  string,
][]

export function QuoteForm() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)

  // Form state
  const [insuranceLine, setInsuranceLine] = useState<InsuranceLine | ''>('')
  const [clientName, setClientName] = useState('')
  const [phone, setPhone] = useState('')
  const [zipCode, setZipCode] = useState('')
  const [coverageType, setCoverageType] = useState<CoverageType | ''>('')

  // Vehicle fields (only for auto)
  const [vehicleBrand, setVehicleBrand] = useState('')
  const [vehicleModel, setVehicleModel] = useState('')
  const [vehicleYear, setVehicleYear] = useState('')

  const isAuto = insuranceLine === 'auto'

  function resetForm() {
    setInsuranceLine('')
    setClientName('')
    setPhone('')
    setZipCode('')
    setCoverageType('')
    setVehicleBrand('')
    setVehicleModel('')
    setVehicleYear('')
    setRequestId(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!insuranceLine || !clientName || !zipCode) {
      toast.error('Completa los campos obligatorios')
      return
    }
    if (isAuto && (!vehicleBrand || !vehicleModel || !vehicleYear)) {
      toast.error('Completa los datos del vehiculo')
      return
    }

    setLoading(true)
    try {
      const payload: Record<string, unknown> = {
        insurance_line: insuranceLine,
        client: {
          name: clientName,
          phone: phone || undefined,
          zip_code: zipCode,
        },
        coverage_type: coverageType || undefined,
        source: 'web' as const,
      }

      if (isAuto) {
        payload.vehicle = {
          brand: vehicleBrand,
          model: vehicleModel,
          year: Number(vehicleYear),
          use: 'particular',
        }
      }

      const res = await fetch('/api/insurance/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? 'Error al iniciar cotizacion')
      }

      const data = await res.json()
      setRequestId(data.request_id)
      toast.success('Cotizacion iniciada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }

  function handleClose(isOpen: boolean) {
    if (!isOpen) {
      resetForm()
    }
    setOpen(isOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button>
          <FileText className="w-4 h-4" />
          Nueva cotizacion
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva cotizacion</DialogTitle>
          <DialogDescription>
            Cotiza simultaneamente en todas las aseguradoras conectadas.
          </DialogDescription>
        </DialogHeader>

        {requestId ? (
          <QuoteProgress requestId={requestId} />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="insurance_line">Linea de seguro *</Label>
              <Select
                value={insuranceLine}
                onValueChange={(v) => setInsuranceLine(v as InsuranceLine)}
              >
                <SelectTrigger id="insurance_line">
                  <SelectValue placeholder="Selecciona tipo de seguro" />
                </SelectTrigger>
                <SelectContent>
                  {INSURANCE_LINES.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="client_name">Nombre del cliente *</Label>
              <Input
                id="client_name"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Juan Perez"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Telefono</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="55 1234 5678"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="zip_code">Codigo postal *</Label>
                <Input
                  id="zip_code"
                  value={zipCode}
                  onChange={(e) => setZipCode(e.target.value)}
                  placeholder="06600"
                  maxLength={5}
                />
              </div>
            </div>

            {isAuto && (
              <div className="space-y-4 rounded-lg border border-zinc-200 p-4">
                <p className="text-sm font-medium text-zinc-700">
                  Datos del vehiculo
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="v_brand">Marca *</Label>
                    <Input
                      id="v_brand"
                      value={vehicleBrand}
                      onChange={(e) => setVehicleBrand(e.target.value)}
                      placeholder="Toyota"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="v_model">Modelo *</Label>
                    <Input
                      id="v_model"
                      value={vehicleModel}
                      onChange={(e) => setVehicleModel(e.target.value)}
                      placeholder="Corolla"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="v_year">Ano *</Label>
                    <Input
                      id="v_year"
                      type="number"
                      value={vehicleYear}
                      onChange={(e) => setVehicleYear(e.target.value)}
                      placeholder="2024"
                      min={2000}
                      max={2027}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="coverage_type">Tipo de cobertura</Label>
              <Select
                value={coverageType}
                onValueChange={(v) => setCoverageType(v as CoverageType)}
              >
                <SelectTrigger id="coverage_type">
                  <SelectValue placeholder="Selecciona cobertura" />
                </SelectTrigger>
                <SelectContent>
                  {COVERAGE_TYPES.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={loading}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? 'Iniciando...' : 'Cotizar'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
