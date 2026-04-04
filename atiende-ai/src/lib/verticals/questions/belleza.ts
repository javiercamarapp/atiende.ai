import type { VerticalEnum, VerticalQuestion } from '../types';

export const bellezaQuestions: Partial<Record<VerticalEnum, VerticalQuestion[]>> = {
  salon_belleza: [
    {
      number: 1,
      text: 'Nombre del salon',
      why: 'Tal como aparece en fachada y redes',
      inputType: 'text',
      required: true,
    },
    {
      number: 2,
      text: 'Direccion y horario por dia',
      why: 'Incluir si sabados medio dia o domingo',
      inputType: 'text',
      required: true,
    },
    {
      number: 3,
      text: 'Lista COMPLETA de servicios con precio, duracion y nivel de estilista',
      why: 'Corte dama/caballero/nino, tinte raiz/completo, mechas/balayage/babylights, alisado, permanente, extensiones, peinado, maquillaje, depilacion, tratamientos capilares. PRECIO EXACTO por servicio',
      inputType: 'price_list',
      required: true,
      followUpInsight:
        'Los precios son la causa #1 de confrontacion en salones. Con la lista exacta, tu bot evita malentendidos.',
    },
    {
      number: 4,
      text: 'Estilistas y sus especialidades',
      why: 'Nombre, dias que trabajan, especialidad. Si hay niveles (junior, senior, master) con diferentes precios',
      inputType: 'textarea',
      required: true,
    },
    {
      number: 5,
      text: 'Aceptan walk-in o solo cita?',
      why: 'Y que porcentaje es walk-in vs. cita',
      inputType: 'text',
      required: true,
      followUpInsight:
        "El 60% de los mensajes de WhatsApp son '¿Tienen espacio hoy?'. Tu bot respondera al instante.",
    },
    {
      number: 6,
      text: 'Politica de cancelacion y no-show',
      why: 'Anticipacion, penalizacion, deposito',
      inputType: 'text',
      required: true,
    },
    {
      number: 7,
      text: 'Anticipo requerido para cita?',
      why: 'Monto o porcentaje. Reembolsable?',
      inputType: 'text',
      required: false,
    },
    {
      number: 8,
      text: 'Productos que venden',
      why: 'Marcas (Kerastase, Wella, L\'Oreal, Olaplex, etc.), tipo, precios',
      inputType: 'textarea',
      required: false,
    },
    {
      number: 9,
      text: 'Programa de lealtad',
      why: 'Puntos, descuento por referido, 5ta visita gratis, etc',
      inputType: 'text',
      required: false,
    },
    {
      number: 10,
      text: 'Promociones recurrentes',
      why: 'Lunes de descuento, paquetes novia, dia de la madre, etc',
      inputType: 'text',
      required: false,
    },
    {
      number: 11,
      text: 'Formas de pago',
      why: 'Efectivo, tarjeta, SPEI, MSI (para servicios premium como alisados)',
      inputType: 'multiselect',
      required: true,
    },
    {
      number: 12,
      text: 'Facturacion CFDI',
      why: 'Disponible?',
      inputType: 'boolean',
      required: false,
    },
    {
      number: 13,
      text: 'Estacionamiento',
      why: 'Propio o cercano',
      inputType: 'text',
      required: false,
    },
    {
      number: 14,
      text: 'Redes sociales',
      why: 'Instagram con portfolio es CRITICO para salones',
      inputType: 'text',
      required: false,
    },
    {
      number: 15,
      text: 'Tono del chatbot',
      why: "Amigable, empoderador, experto. 'Vamos a dejarte increible.'",
      inputType: 'select',
      required: true,
    },
    {
      number: 16,
      text: 'Contacto de escalacion',
      why: 'Duena o estilista senior',
      inputType: 'text',
      required: true,
    },
  ],

  // Sprint 1 stubs — full questions coming in future sprints
  barberia: [],
  spa: [],
  gimnasio: [],
  nail_salon: [],
  estetica: [],
};
