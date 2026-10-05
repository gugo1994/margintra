import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Tenant } from '../../../common/decorators/tenant.decorator';
import { TenantContext } from '../../../common/interfaces/tenant-context.interface';
import { CreateApiKeyDto } from './api-key.dto';
import { ApiKeyService } from './api-key.service';

@Controller('integrations/usage-api-keys')
export class ApiKeyController {
  constructor(private readonly service: ApiKeyService) {}
  @Post() create(@Tenant() tenant: TenantContext, @Body() dto: CreateApiKeyDto) {
    return this.service.create(tenant.organizationId, dto.name);
  }
  @Get() list(@Tenant() tenant: TenantContext) {
    return this.service.list(tenant.organizationId);
  }
  @Post(':id/rotate') rotate(
    @Tenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.rotate(tenant.organizationId, id);
  }
  @Delete(':id') revoke(
    @Tenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.revoke(tenant.organizationId, id);
  }
}
