import { Body, Controller, Get, Put } from '@nestjs/common';
import { Tenant } from '../../common/decorators/tenant.decorator';
import { TenantContext } from '../../common/interfaces/tenant-context.interface';
import { UpdateNotificationPreferencesDto } from './dto/notification-preferences.dto';
import { NotificationService } from './notification.service';
@Controller('settings/notifications')
export class NotificationController {
  constructor(private readonly service: NotificationService) {}
  @Get() get(@Tenant() t: TenantContext) {
    return this.service.getPreferences(t.organizationId);
  }
  @Put() update(@Tenant() t: TenantContext, @Body() dto: UpdateNotificationPreferencesDto) {
    return this.service.updatePreferences(t.organizationId, t.userId, dto);
  }
  @Get('deliveries') recent(@Tenant() t: TenantContext) {
    return this.service.recent(t.organizationId);
  }
}
