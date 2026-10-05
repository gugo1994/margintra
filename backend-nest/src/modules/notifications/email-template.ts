import { EmailDeliveryRequest } from './email.gateway';

export interface EmailTemplate {
  subject: string;
  text: string;
}

export const createEmailTemplate = (
  request: EmailDeliveryRequest,
  dashboardUrl: string | null,
): EmailTemplate => {
  const kind =
    request.transition === 'resolved'
      ? 'Recovery'
      : request.budgetState === 'critical'
        ? 'Critical'
        : 'Warning';
  const margin = request.grossMargin === null ? 'N/A' : `${request.grossMargin}%`;
  const lines = [
    `${kind} profitability alert for ${request.customerName}`,
    `Revenue: ${request.revenue} ${request.currency}`,
    `AI cost: ${request.aiCost} ${request.currency}`,
    `Gross margin: ${margin}`,
    `Budget state: ${request.budgetState}`,
  ];
  if (dashboardUrl) lines.push(`Open Margintra: ${dashboardUrl}`);
  return { subject: `[Margintra] ${kind}: ${request.customerName}`, text: lines.join('\n') };
};
