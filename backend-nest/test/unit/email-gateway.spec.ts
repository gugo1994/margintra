import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { EmailConfiguration, loadEmailConfig } from '../../src/config/configuration';
import { DevelopmentEmailGateway } from '../../src/modules/notifications/development-email.gateway';
import {
  EmailDeliveryRequest,
  EmailGatewayError,
} from '../../src/modules/notifications/email.gateway';
import { createEmailTemplate } from '../../src/modules/notifications/email-template';
import { selectEmailGateway } from '../../src/modules/notifications/notification.module';
import { ResendEmailGateway } from '../../src/modules/notifications/resend-email.gateway';

const request: EmailDeliveryRequest = {
  deliveryId: 'delivery-id',
  organizationId: 'organization-id',
  alertId: 'alert-id',
  recipient: 'finance@example.test',
  transition: 'opened_warning',
  customerName: 'Acme',
  revenue: '100.00',
  aiCost: '20.500000',
  grossMargin: '79.5000',
  budgetState: 'warning',
  currency: 'USD',
};
const settings: EmailConfiguration = {
  provider: 'resend',
  apiKey: 're_top_secret',
  fromEmail: 'alerts@example.test',
  fromName: 'Margintra',
  dashboardUrl: 'https://margintra.example.test/customers',
};
const config = (value: EmailConfiguration) =>
  ({ getOrThrow: () => value }) as unknown as ConfigService;

describe('production email gateway', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends minimal Resend content without usage metadata', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    await new ResendEmailGateway(config(settings)).send(request);
    const options = fetchMock.mock.calls[0]![1]!;
    expect(typeof options.body).toBe('string');
    const body = JSON.parse(options.body as string) as {
      subject: string;
      text: string;
      to: string[];
    };
    expect(body).toMatchObject({ to: [request.recipient], subject: '[Margintra] Warning: Acme' });
    expect(body.text).toContain('Revenue: 100.00 USD');
    expect(body.text).toContain('Gross margin: 79.5000%');
    expect(body.text).not.toMatch(/prompt|completion|token/i);
    expect(options.headers).toMatchObject({ 'Idempotency-Key': request.deliveryId });
  });

  it.each([
    [429, true],
    [503, true],
    [400, false],
    [403, false],
  ])(
    'maps provider status %s to retryable=%s without leaking provider data',
    async (status, retryable) => {
      jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status } as Response);
      const error = await new ResendEmailGateway(config(settings))
        .send(request)
        .catch((value: unknown) => value);
      expect(error).toBeInstanceOf(EmailGatewayError);
      expect((error as EmailGatewayError).retryable).toBe(retryable);
      expect(String(error)).not.toContain(settings.apiKey!);
      expect(String(error)).not.toContain(request.recipient);
    },
  );

  it('maps network failures to a sanitized retryable error', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('network response containing secret data'));
    const error = await new ResendEmailGateway(config(settings))
      .send(request)
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ retryable: true, message: 'Email delivery failed.' });
    expect(String(error)).not.toContain('secret data');
  });

  it('selects development or Resend without changing the gateway interface', () => {
    const development = new DevelopmentEmailGateway();
    const resend = new ResendEmailGateway(config(settings));
    expect(
      selectEmailGateway(config({ ...settings, provider: 'development' }), development, resend),
    ).toBe(development);
    expect(selectEmailGateway(config(settings), development, resend)).toBe(resend);
  });

  it('selects distinct warning, critical, and recovery templates', () => {
    expect(createEmailTemplate(request, null).subject).toContain('Warning');
    expect(createEmailTemplate({ ...request, budgetState: 'critical' }, null).subject).toContain(
      'Critical',
    );
    const recovery = createEmailTemplate(
      { ...request, transition: 'resolved', budgetState: 'healthy' },
      null,
    );
    expect(recovery.subject).toContain('Recovery');
    expect(recovery.text).toContain('Budget state: healthy');
  });

  it('does not log raw recipients or notification content in development', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await new DevelopmentEmailGateway().send(request);
    const output = JSON.stringify(log.mock.calls);
    expect(output).not.toContain(request.recipient);
    expect(output).not.toContain(request.customerName);
    expect(output).not.toContain(request.revenue);
  });
});

describe('email configuration', () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env = { ...original };
    delete process.env.EMAIL_PROVIDER;
    delete process.env.EMAIL_API_KEY;
    delete process.env.EMAIL_FROM_EMAIL;
    delete process.env.EMAIL_FROM_NAME;
    delete process.env.MARGINTRA_DASHBOARD_URL;
  });
  afterAll(() => {
    process.env = original;
  });

  it('defaults development to the safe development gateway', () => {
    process.env.APP_ENV = 'development';
    expect(loadEmailConfig().provider).toBe('development');
  });

  it('defaults production to Resend and fails fast when required configuration is absent', () => {
    process.env.APP_ENV = 'production';
    expect(loadEmailConfig).toThrow('Resend requires valid');
  });

  it('accepts complete production Resend configuration and rejects development selection', () => {
    process.env.APP_ENV = 'production';
    process.env.EMAIL_API_KEY = 're_configured';
    process.env.EMAIL_FROM_EMAIL = 'alerts@example.com';
    process.env.EMAIL_FROM_NAME = 'Margintra Alerts';
    expect(loadEmailConfig()).toMatchObject({
      provider: 'resend',
      fromEmail: 'alerts@example.com',
    });
    process.env.EMAIL_PROVIDER = 'development';
    expect(loadEmailConfig).toThrow('Production requires');
  });
});
