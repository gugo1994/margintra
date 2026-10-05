import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailConfiguration } from '../../config/configuration';
import { EmailDeliveryRequest, EmailGateway, EmailGatewayError } from './email.gateway';
import { createEmailTemplate } from './email-template';

@Injectable()
export class ResendEmailGateway implements EmailGateway {
  constructor(private readonly config: ConfigService) {}

  async send(request: EmailDeliveryRequest): Promise<void> {
    const settings = this.config.getOrThrow<EmailConfiguration>('email');
    const template = createEmailTemplate(request, settings.dashboardUrl);
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.apiKey!}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': request.deliveryId,
        },
        body: JSON.stringify({
          from: `${settings.fromName} <${settings.fromEmail!}>`,
          to: [request.recipient],
          subject: template.subject,
          text: template.text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        throw new EmailGatewayError(
          response.status === 408 || response.status === 429 || response.status >= 500,
        );
    } catch (error) {
      if (error instanceof EmailGatewayError) throw error;
      throw new EmailGatewayError(true);
    }
  }
}
