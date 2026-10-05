import { Body, Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import { Tenant } from '../../../../common/decorators/tenant.decorator';
import { TenantContext } from '../../../../common/interfaces/tenant-context.interface';
import { ConnectStripeDto, UpdateStripeWebhookSecretDto } from '../dto/stripe.dto';
import { StripeConnectionService } from '../services/stripe-connection.service';
import { StripeSyncService } from '../services/stripe-sync.service';
@Controller('integrations/stripe')
export class StripeController {
  constructor(
    private readonly connections: StripeConnectionService,
    private readonly syncService: StripeSyncService,
  ) {}
  @Get() get(@Tenant() t: TenantContext) {
    return this.connections.get(t.organizationId);
  }
  @Post('connect') connect(@Tenant() t: TenantContext, @Body() dto: ConnectStripeDto) {
    return this.connections.connect(t.organizationId, dto);
  }
  @Put('webhook-secret') webhook(
    @Tenant() t: TenantContext,
    @Body() dto: UpdateStripeWebhookSecretDto,
  ) {
    return this.connections.updateWebhookSecret(t.organizationId, dto.webhookSecret);
  }
  @Post('sync') sync(@Tenant() t: TenantContext) {
    return this.syncService.sync(t.organizationId);
  }
  @Delete() @HttpCode(204) disconnect(@Tenant() t: TenantContext) {
    return this.connections.disconnect(t.organizationId);
  }
}
