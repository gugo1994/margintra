import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { IngestionApiKeyGuard } from '../api-keys/ingestion-api-key.guard';
import { IngestionTenant } from '../api-keys/ingestion-context.decorator';
import { IngestionContext } from '../api-keys/ingestion-context';
import { ProductionUsageDto } from '../dto/production-usage.dto';
import { IngestionRateLimitService } from '../services/ingestion-rate-limit.service';
import { ProductionIngestionService } from '../services/production-ingestion.service';

@Public()
@UseGuards(IngestionApiKeyGuard)
@Controller('ingest')
export class IngestionController {
  constructor(
    private readonly service: ProductionIngestionService,
    private readonly rateLimit: IngestionRateLimitService,
  ) {}
  @Post('usage')
  @HttpCode(HttpStatus.ACCEPTED)
  async usage(@IngestionTenant() context: IngestionContext, @Body() dto: ProductionUsageDto) {
    await this.rateLimit.check(context.apiKeyId);
    return this.service.ingest(context.organizationId, dto);
  }
}
