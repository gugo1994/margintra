import { Module } from '@nestjs/common';
import { RevenueHistoryService } from './revenue-history.service';

@Module({
  providers: [RevenueHistoryService],
  exports: [RevenueHistoryService],
})
export class RevenueHistoryModule {}
