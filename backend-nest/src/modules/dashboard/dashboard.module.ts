import { Module } from '@nestjs/common';
import { MarginModule } from '../margin/margin.module';
import { DashboardController } from './controllers/dashboard.controller';
import { DashboardRepository } from './repositories/dashboard.repository';
import { DashboardService } from './services/dashboard.service';
import { AnalyticsRangeService } from './services/analytics-range.service';
@Module({
  imports: [MarginModule],
  controllers: [DashboardController],
  providers: [DashboardRepository, DashboardService, AnalyticsRangeService],
})
export class DashboardModule {}
