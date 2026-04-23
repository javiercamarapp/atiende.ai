import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '3m', target: 25 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    errors: ['rate<0.05'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';

const params = {
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${AUTH_TOKEN}`,
  },
  timeout: '10s',
};

export default function () {
  // Rotate through dashboard endpoints
  const endpoints = [
    '/api/conversations?page=1&limit=20',
    '/api/analytics/dashboard',
    '/api/usage',
  ];

  const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
  const res = http.get(`${BASE_URL}${endpoint}`, params);

  const success = check(res, {
    'status is 200 or 401': (r) => r.status === 200 || r.status === 401,
    'response time < 2s': (r) => r.timings.duration < 2000,
  });

  errorRate.add(res.status >= 500);
  sleep(1 + Math.random() * 2);
}
