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
import { Plus } from 'lucide-react'

interface Carrier {
  id: string
  name: string
}

interface CredentialFormProps {
  carriers: Carrier[]
}

export function CredentialForm({ carriers }: CredentialFormProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [carrierId, setCarrierId] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [agentNumber, setAgentNumber] = useState('')

  function resetForm() {
    setCarrierId('')
    setUsername('')
    setPassword('')
    setAgentNumber('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!carrierId || !username || !password) {
      toast.error('Completa los campos obligatorios')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/insurance/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          carrier_id: carrierId,
          username,
          password,
          agent_number: agentNumber || null,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? 'Error al guardar credenciales')
      }

      toast.success('Credenciales guardadas correctamente')
      resetForm()
      setOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="w-4 h-4" />
          Agregar credenciales
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar credenciales</DialogTitle>
          <DialogDescription>
            Ingresa tus credenciales del portal de la aseguradora para habilitar
            la cotizacion automatica.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="carrier">Aseguradora *</Label>
            <Select value={carrierId} onValueChange={setCarrierId}>
              <SelectTrigger id="carrier">
                <SelectValue placeholder="Selecciona una aseguradora" />
              </SelectTrigger>
              <SelectContent>
                {carriers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="username">Usuario *</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="usuario@portal.com"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Contrasena *</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent_number">Numero de agente</Label>
            <Input
              id="agent_number"
              value={agentNumber}
              onChange={(e) => setAgentNumber(e.target.value)}
              placeholder="Opcional"
            />
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
              {loading ? 'Guardando...' : 'Guardar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
