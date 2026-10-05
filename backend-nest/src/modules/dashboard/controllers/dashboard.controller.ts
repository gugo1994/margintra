import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Tenant } from '../../../common/decorators/tenant.decorator';
import { TenantContext } from '../../../common/interfaces/tenant-context.interface';
import { DashboardService } from '../services/dashboard.service';
import {
  AnalyticsQueryDto,
  CustomerProfitabilityHistoryQueryDto,
} from '../dto/analytics-query.dto';
@Controller()
export class DashboardController {
  constructor(private readonly service: DashboardService) {}
  @Get('dashboard/overview') overview(@Tenant() t: TenantContext) {
    return this.service.overview(t.organizationId);
  }
  @Get('dashboard/customers') customers(@Tenant() t: TenantContext) {
    return this.service.customers(t.organizationId);
  }
  @Get('analytics/features') features(@Tenant() t: TenantContext) {
    return this.service.features(t.organizationId);
  }
  @Get('analytics/profitability') profitability(
    @Tenant() t: TenantContext,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.service.profitability(t.organizationId, query);
  }
  @Get('analytics/profitability/forecast-summary') profitabilityForecastSummary(
    @Tenant() t: TenantContext,
  ) {
    return this.service.profitabilityForecastSummary(t.organizationId);
  }
  @Get('analytics/profitability/customers/:id') customerProfitability(
    @Tenant() t: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.service.customerProfitability(t.organizationId, id, query);
  }
  @Get('analytics/profitability/customers/:id/history') customerProfitabilityHistory(
    @Tenant() t: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CustomerProfitabilityHistoryQueryDto,
  ) {
    return this.service.customerProfitabilityHistory(t.organizationId, id, query);
  }
  @Get('analytics/profitability/customers/:id/cost-drivers') customerCostDrivers(
    @Tenant() t: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.service.customerCostDrivers(t.organizationId, id, query);
  }
  @Get('analytics/profitability/customers/:id/forecast') customerProfitabilityForecast(
    @Tenant() t: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.customerProfitabilityForecast(t.organizationId, id);
  }
}
