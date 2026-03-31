import axios from 'axios';

// Cloudbeds PMS para hoteles — verificar disponibilidad de habitaciones
export async function checkRoomAvailability(opts: {
  checkIn: string; // YYYY-MM-DD
  checkOut: string;
  adults: number;
  children?: number;
}) {
  if (!process.env.CLOUDBEDS_CLIENT_ID) return null;
  try {
    // OAuth2 token
    const tokenRes = await axios.post('https://hotels.cloudbeds.com/api/v1.2/access_token', {
      grant_type: 'client_credentials',
      client_id: process.env.CLOUDBEDS_CLIENT_ID,
      client_secret: process.env.CLOUDBEDS_CLIENT_SECRET,
    });
    const token = tokenRes.data.access_token;

    // Check availability
    const { data } = await axios.get('https://api.cloudbeds.com/api/v1.2/getAvailableRoomTypes', {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        startDate: opts.checkIn,
        endDate: opts.checkOut,
        adults: opts.adults,
        children: opts.children || 0,
      },
    });
    return data.data || [];
  } catch (e) {
    console.error('Cloudbeds error:', e);
    return null;
  }
}

// Crear reservación
export async function createReservation(opts: {
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  checkIn: string;
  checkOut: string;
  roomTypeId: string;
}) {
  // Similar flow — POST a /api/v1.2/postReservation
  // Implementar cuando el hotel conecte su cuenta Cloudbeds
  return null;
}
