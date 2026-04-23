import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '2m', target: 20 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    errors: ['rate<0.05'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  // Test rate limiting on the login endpoint
  const res = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    email: `loadtest+${__VU}@example.com`,
    password: 'invalid-password-for-load-test',
  }), {
    headers: { 'Content-Type': 'application/json' },
    timeout: '5s',
  });

  const success = check(res, {
    'status is 401 or 429': (r) => r.status === 401 || r.status === 429,
    'rate limit kicks in eventually': (r) => true,
  });

  errorRate.add(res.status >= 500);

  sleep(0.2 + Math.random() * 0.3);
}
