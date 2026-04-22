import http from 'k6/http';
import crypto from 'k6/crypto';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const webhookDuration = new Trend('webhook_duration');

export const options = {
  stages: [
    { duration: '1m', target: 10 },   // ramp up
    { duration: '3m', target: 30 },   // sustained load
    { duration: '1m', target: 50 },   // peak
    { duration: '1m', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    errors: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const WA_APP_SECRET = __ENV.WA_APP_SECRET || 'test-secret';

function makeWebhookPayload(phoneNumber) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: '100000000000000',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: '5219991234567',
            phone_number_id: 'test-phone-number-id',
          },
          messages: [{
            from: phoneNumber,
            id: `wamid.load_test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            timestamp: timestamp,
            text: { body: 'Hola, quiero agendar una cita para mañana a las 3pm' },
            type: 'text',
          }],
        },
        field: 'messages',
      }],
    }],
  });
}

function signPayload(payload) {
  const hmac = crypto.createHMAC('sha256', WA_APP_SECRET);
  hmac.update(payload);
  return 'sha256=' + hmac.hexDigest();
}

export default function () {
  const phoneNumber = `5219990${String(Math.floor(Math.random() * 9000000) + 1000000)}`;
  const payload = makeWebhookPayload(phoneNumber);
  const signature = signPayload(payload);

  const res = http.post(`${BASE_URL}/api/webhook/whatsapp`, payload, {
    headers: {
      'Content-Type': 'application/json',
      'x-hub-signature-256': signature,
    },
    timeout: '10s',
  });

  const success = check(res, {
    'status is 200': (r) => r.status === 200,
    'response has status field': (r) => {
      try { return JSON.parse(r.body).status !== undefined; } catch { return false; }
    },
  });

  errorRate.add(!success);
  webhookDuration.add(res.timings.duration);

  sleep(0.5 + Math.random());
}
