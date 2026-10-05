import { Body, Controller, Post } from '@nestjs/common';
import { Tenant } from '../../../common/decorators/tenant.decorator';
import { TenantContext } from '../../../common/interfaces/tenant-context.interface';
import { IngestUsageDto } from '../dto/usage.dto';
import { UsageIngestionService } from '../services/usage-ingestion.service';
@Controller('usage')
export class UsageController {
  constructor(private readonly service: UsageIngestionService) {}
  @Post() ingest(@Tenant() tenant: TenantContext, @Body() dto: IngestUsageDto) {
    return this.service.ingest(tenant.organizationId, dto);
  }
}
