import { Controller, Get, Post } from '@nestjs/common';
import { Tenant } from '../../common/decorators/tenant.decorator';
import { TenantContext } from '../../common/interfaces/tenant-context.interface';
import { OnboardingService } from './onboarding.service';

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly service: OnboardingService) {}

  @Get()
  getStatus(@Tenant() tenant: TenantContext) {
    return this.service.getStatus(tenant.organizationId);
  }

  @Post('start')
  start(@Tenant() tenant: TenantContext) {
    return this.service.start(tenant.organizationId);
  }

  @Post('complete')
  complete(@Tenant() tenant: TenantContext) {
    return this.service.complete(tenant.organizationId);
  }
}
