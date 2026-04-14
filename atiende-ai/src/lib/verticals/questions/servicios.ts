import type { VerticalEnum, VerticalQuestion } from '../types';

export const serviciosQuestions: Partial<Record<VerticalEnum, VerticalQuestion[]>> = {
  // Sprint 1 stubs — full questions coming in future sprints
  contable_legal: [],
  seguros: [],
  taller_mecanico: [],
  escuela: [],
  agencia_digital: [],
  fotografo: [],

  condominio: [
    {
      number: 1,
      text: 'Nombre del condominio o fraccionamiento',
      why: 'Exactamente como aparece en los documentos oficiales y letreros',
      inputType: 'text',
      required: true,
    },
    {
      number: 2,
      text: 'Direccion completa y referencias del acceso principal',
      why: 'Calle, numero, colonia, CP, ciudad + como llegar a la caseta o entrada',
      inputType: 'text',
      required: true,
    },
    {
      number: 3,
      text: 'Horario de atencion de la administracion',
      why: 'Dias y horas en que el administrador puede ser contactado directamente',
      inputType: 'text',
      required: true,
      followUpInsight:
        'La mayoria de los residentes reportan fallas fuera del horario de oficina. Tu agente va a capturar solicitudes 24/7 y priorizarlas para el equipo de mantenimiento.',
    },
    {
      number: 4,
      text: 'Nombre del administrador o empresa administradora y telefono de contacto',
      why: 'El residente lo necesita para escaladas urgentes',
      inputType: 'text',
      required: true,
    },
    {
      number: 5,
      text: 'Numero total de unidades / departamentos / casas',
      why: 'Para contextualizar el volumen de solicitudes y respuestas del agente',
      inputType: 'number',
      required: true,
    },
    {
      number: 6,
      text: 'Cuota de mantenimiento mensual ordinaria (por unidad)',
      why: 'La pregunta mas frecuente de residentes y compradores potenciales; precio exacto en pesos MXN',
      inputType: 'text',
      required: true,
      followUpInsight:
        'El cobro de cuotas es el proceso que mas tiempo consume en una administracion. Tu agente va a responder saldos y fechas de pago automaticamente.',
    },
    {
      number: 7,
      text: 'Formas de pago aceptadas y fecha limite de pago mensual',
      why: 'Transferencia, efectivo, deposito — y que dia del mes es el corte',
      inputType: 'text',
      required: true,
    },
    {
      number: 8,
      text: 'Servicios e instalaciones disponibles (alberca, gym, salon de eventos, vigilancia 24/7, estacionamiento de visitas, etc.)',
      why: 'Los residentes y prospectos preguntan esto constantemente',
      inputType: 'textarea',
      required: true,
    },
    {
      number: 9,
      text: 'Procedimiento para reportar una falla o solicitar mantenimiento',
      why: 'Pasos exactos: por WhatsApp, correo, formato especifico — lo que aplique',
      inputType: 'textarea',
      required: true,
    },
    {
      number: 10,
      text: 'Penalizacion por pago tardio (monto o porcentaje)',
      why: 'Recargos exactos para orientar a residentes con adeudos',
      inputType: 'text',
      required: false,
    },
    {
      number: 11,
      text: 'Proveedores de servicios autorizados (plomero, electricista, cerrajero)',
      why: 'Nombres y telefonos de los autorizados por el condominio para trabajos internos',
      inputType: 'textarea',
      required: false,
    },
    {
      number: 12,
      text: 'Puntos principales del reglamento interno (mascotas, horario de ruido, remodelaciones)',
      why: 'Reglas mas frecuentemente consultadas por residentes',
      inputType: 'textarea',
      required: false,
    },
    {
      number: 13,
      text: 'Horarios de limpieza y mantenimiento de areas comunes',
      why: 'Cuando no se puede usar la alberca, cuando hay fumigacion, dias de jardineria, etc.',
      inputType: 'text',
      required: false,
    },
    {
      number: 14,
      text: 'Datos de la cuenta bancaria o CLABE para pagos de cuota',
      why: 'Para que el bot pueda dar los datos de transferencia directamente al residente',
      inputType: 'text',
      required: false,
    },
  ],
};
