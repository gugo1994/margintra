export const EMAIL_GATEWAY = Symbol('EMAIL_GATEWAY');
export interface EmailDeliveryRequest {
  deliveryId: string;
  organizationId: string;
  alertId: string;
  recipient: string;
  transition: string;
  customerName: string;
  revenue: string;
  aiCost: string;
  grossMargin: string | null;
  budgetState: 'warning' | 'critical' | 'healthy';
  currency: string;
}
export interface EmailGateway {
  send(request: EmailDeliveryRequest): Promise<void>;
}
export class EmailGatewayError extends Error {
  constructor(public readonly retryable: boolean) {
    super('Email delivery failed.');
  }
}
