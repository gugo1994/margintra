import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EmailDeliveryRequest, EmailGateway } from './email.gateway';
@Injectable()
export class DevelopmentEmailGateway implements EmailGateway {
  private readonly logger = new Logger(DevelopmentEmailGateway.name);
  send(request: EmailDeliveryRequest): Promise<void> {
    this.logger.log({
      event: 'DevelopmentEmailDelivered',
      deliveryId: request.deliveryId,
      organizationId: request.organizationId,
      alertId: request.alertId,
      recipientHash: createHash('sha256').update(request.recipient).digest('hex').slice(0, 12),
      transition: request.transition,
    });
    return Promise.resolve();
  }
}
