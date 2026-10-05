import request from 'supertest';
import { TestApp } from '../support/test-app';

describe('operational endpoints and correlation (PostgreSQL/Redis)', () => {
  const fixture = new TestApp();
  beforeAll(() => fixture.start(), 30_000);
  afterAll(() => fixture.close());

  it('reports liveness, dependency readiness, and safe Prometheus metrics', async () => {
    await request(fixture.server()).get('/health/live').expect(200, { status: 'alive' });
    const ready = await request(fixture.server()).get('/health/ready').expect(200);
    expect(ready.body).toEqual({ status: 'ready', checks: { postgresql: 'up', redis: 'up' } });
    const metrics = await request(fixture.server()).get('/metrics').expect(200);
    expect(metrics.text).toContain('margintra_http_requests_total');
    expect(metrics.text).toContain('margintra_notification_deliveries{status="pending"}');
    expect(metrics.text).not.toMatch(/recipient|authorization|secret/i);
  });

  it('propagates correlation IDs into headers and safe error responses', async () => {
    const response = await request(fixture.server())
      .post('/api/v1/auth/login')
      .set('X-Request-Id', 'test-correlation-id')
      .send({})
      .expect(400);
    expect(response.headers['x-request-id']).toBe('test-correlation-id');
    expect(response.body).toMatchObject({ correlationId: 'test-correlation-id', status: 400 });
    expect(JSON.stringify(response.body)).not.toMatch(/stack|password|database|jwt/i);
  });
});
