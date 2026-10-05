import {
  Controller,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../../../common/decorators/public.decorator';
import { ValidationError } from '../../../../common/errors/application.error';
import { StripeWebhookService } from '../services/stripe-webhook.service';
@Public()
@Controller('webhooks/stripe')
export class StripeWebhookController {
  constructor(private readonly service: StripeWebhookService) {}
  @Post(':connectionIdentifier') handle(
    @Param('connectionIdentifier', ParseUUIDPipe) id: string,
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    if (!signature) throw new ValidationError('Stripe-Signature is required.');
    if (!request.rawBody) throw new ValidationError('Raw webhook body is required.');
    return this.service.handle(id, request.rawBody, signature);
  }
}
