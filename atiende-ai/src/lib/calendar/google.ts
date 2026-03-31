import { google } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
];

export async function getCalendarClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.split('\\n').join('\n'),
      project_id: process.env.GOOGLE_PROJECT_ID,
    },
    scopes: SCOPES,
  });
  return google.calendar({ version: 'v3', auth });
}

// Crear evento en Google Calendar del doctor/staff
export async function createCalendarEvent(opts: {
  calendarId: string; // el Google Calendar ID del staff
  summary: string;
  description: string;
  startTime: string; // ISO 8601
  endTime: string;
  attendeeEmail?: string;
  attendeeName?: string;
  timezone?: string;
}) {
  const calendar = await getCalendarClient();
  const event = await calendar.events.insert({
    calendarId: opts.calendarId,
    requestBody: {
      summary: opts.summary,
      description: opts.description,
      start: { dateTime: opts.startTime, timeZone: opts.timezone || 'America/Merida' },
      end: { dateTime: opts.endTime, timeZone: opts.timezone || 'America/Merida' },
      attendees: opts.attendeeEmail
        ? [{ email: opts.attendeeEmail, displayName: opts.attendeeName }]
        : [],
      reminders: { useDefault: false, overrides: [
        { method: 'popup', minutes: 30 },
      ]},
    },
  });
  return {
    eventId: event.data.id!,
    htmlLink: event.data.htmlLink!,
  };
}

// Verificar disponibilidad del staff
export async function getFreeBusySlots(opts: {
  calendarId: string;
  startDate: string; // ISO
  endDate: string;
  timezone?: string;
}) {
  const calendar = await getCalendarClient();
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: opts.startDate,
      timeMax: opts.endDate,
      timeZone: opts.timezone || 'America/Merida',
      items: [{ id: opts.calendarId }],
    },
  });
  const busy = res.data.calendars?.[opts.calendarId]?.busy || [];
  return busy.map(b => ({
    start: b.start!,
    end: b.end!,
  }));
}

// Cancelar evento
export async function cancelCalendarEvent(calendarId: string, eventId: string) {
  const calendar = await getCalendarClient();
  await calendar.events.delete({ calendarId, eventId });
}

// Generar slots disponibles para un dia
export function generateAvailableSlots(opts: {
  date: string; // YYYY-MM-DD
  businessHours: { open: string; close: string }; // "09:00", "18:00"
  duration: number; // minutos
  busySlots: { start: string; end: string }[];
  padding?: number; // minutos entre citas
}) {
  const slots: { start: string; end: string }[] = [];
  const pad = opts.padding || 0;

  const current = new Date(`${opts.date}T${opts.businessHours.open}:00`);
  const endOfDay = new Date(`${opts.date}T${opts.businessHours.close}:00`);

  let cursor = current;

  while (cursor < endOfDay) {
    const slotEnd = new Date(cursor.getTime() + opts.duration * 60000);
    if (slotEnd > endOfDay) break;

    // Verificar que no choque con slots ocupados
    const isBusy = opts.busySlots.some(busy => {
      const busyStart = new Date(busy.start);
      const busyEnd = new Date(busy.end);
      return cursor < busyEnd && slotEnd > busyStart;
    });

    if (!isBusy) {
      slots.push({
        start: cursor.toISOString(),
        end: slotEnd.toISOString(),
      });
    }

    cursor = new Date(slotEnd.getTime() + pad * 60000);
  }

  return slots;
}
