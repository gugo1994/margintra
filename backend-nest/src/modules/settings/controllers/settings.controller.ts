import { Body, Controller, Get, Put } from '@nestjs/common';
import { Tenant } from '../../../common/decorators/tenant.decorator';
import { TenantContext } from '../../../common/interfaces/tenant-context.interface';
import { UpdateMarginSettingsDto } from '../dto/settings.dto';
import { SettingsService } from '../services/settings.service';
@Controller('settings/margin')
export class SettingsController {
  constructor(private readonly service: SettingsService) {}
  @Get() get(@Tenant() t: TenantContext) {
    return this.service.get(t.organizationId);
  }
  @Put() update(@Tenant() t: TenantContext, @Body() dto: UpdateMarginSettingsDto) {
    return this.service.update(t.organizationId, t.userId, dto);
  }
}
