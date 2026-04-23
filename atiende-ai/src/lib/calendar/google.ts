import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { decryptPII, encryptPII } from '@/lib/utils/crypto';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/calendar/connect`;

async function getOAuth2ClientForStaff(staffId: string): Promise<OAuth2Client | null> {
  const { data } = await supabaseAdmin
    .from('staff')
    .select('google_refresh_token')
    .eq('id', staffId)
    .maybeSingle();

  const encrypted = data?.google_refresh_token as string | null | undefined;
  if (!encrypted) return null;

  const refreshToken = decryptPII(encrypted);
  if (!refreshToken) return null;

  const client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    REDIRECT_URI,
  );
  client.setCredentials({ refresh_token: refreshToken });

  // Persist rotated refresh tokens if Google ever issues a new one.
  // Access tokens are cached in-memory on the client and auto-refreshed
  // by googleapis whenever they expire (using the refresh_token).
  client.on('tokens', async (tokens) => {
    if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
      const nextEncrypted = encryptPII(tokens.refresh_token);
      if (nextEncrypted) {
        await supabaseAdmin
          .from('staff')
          .update({ google_refresh_token: nextEncrypted })
          .eq('id', staffId);
      }
    }
  });

  return client;
}

async function getCalendarApi(staffId?: string) {
  if (staffId) {
    const oauth = await getOAuth2ClientForStaff(staffId);
    if (oauth) return google.calendar({ version: 'v3', auth: oauth });
  }
  // Legacy service-account fallback (only works with domain-wide delegation).
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.split('\\n').join('\n'),
      project_id: process.env.GOOGLE_PROJECT_ID,
    },
    scopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ],
  });
  return google.calendar({ version: 'v3', auth });
}

export async function createCalendarEvent(opts: {
  staffId?: string;
  calendarId: string;
  summary: string;
  description: string;
  startTime: string;
  endTime: string;
  attendeeEmail?: string;
  attendeeName?: string;
  timezone?: string;
}) {
  const calendar = await getCalendarApi(opts.staffId);
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
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: 30 }],
      },
    },
  });
  return {
    eventId: event.data.id!,
    htmlLink: event.data.htmlLink!,
  };
}

export async function updateCalendarEvent(opts: {
  staffId?: string;
  calendarId: string;
  eventId: string;
  summary?: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  timezone?: string;
}) {
  const calendar = await getCalendarApi(opts.staffId);
  const patch: Record<string, unknown> = {};
  if (opts.summary !== undefined) patch.summary = opts.summary;
  if (opts.description !== undefined) patch.description = opts.description;
  if (opts.startTime) {
    patch.start = { dateTime: opts.startTime, timeZone: opts.timezone || 'America/Merida' };
  }
  if (opts.endTime) {
    patch.end = { dateTime: opts.endTime, timeZone: opts.timezone || 'America/Merida' };
  }
  const event = await calendar.events.patch({
    calendarId: opts.calendarId,
    eventId: opts.eventId,
    requestBody: patch,
  });
  return {
    eventId: event.data.id!,
    htmlLink: event.data.htmlLink!,
  };
}

export async function getFreeBusySlots(opts: {
  staffId?: string;
  calendarId: string;
  startDate: string;
  endDate: string;
  timezone?: string;
}) {
  const calendar = await getCalendarApi(opts.staffId);
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: opts.startDate,
      timeMax: opts.endDate,
      timeZone: opts.timezone || 'America/Merida',
      items: [{ id: opts.calendarId }],
    },
  });
  const busy = res.data.calendars?.[opts.calendarId]?.busy || [];
  return busy.map((b) => ({
    start: b.start!,
    end: b.end!,
  }));
}

export async function cancelCalendarEvent(
  calendarId: string,
  eventId: string,
  staffId?: string,
) {
  const calendar = await getCalendarApi(staffId);
  await calendar.events.delete({ calendarId, eventId });
}

export function generateAvailableSlots(opts: {
  date: string;
  businessHours: { open: string; close: string };
  duration: number;
  busySlots: { start: string; end: string }[];
  padding?: number;
}) {
  const slots: { start: string; end: string }[] = [];
  const pad = opts.padding || 0;

  const current = new Date(`${opts.date}T${opts.businessHours.open}:00`);
  const endOfDay = new Date(`${opts.date}T${opts.businessHours.close}:00`);

  let cursor = current;

  while (cursor < endOfDay) {
    const slotEnd = new Date(cursor.getTime() + opts.duration * 60000);
    if (slotEnd > endOfDay) break;

    const isBusy = opts.busySlots.some((busy) => {
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
