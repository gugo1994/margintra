import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AiUsageEventEntity,
  BillingSubscriptionEntity,
  CustomerEntity,
  MarginAlertEntity,
  MarginSnapshotEntity,
  OrganizationEntity,
} from '../../database/entities';
import { MarginCalculator } from './calculators/margin-calculator';
import { MarginRepository } from './repositories/margin.repository';
import { MarginService } from './services/margin.service';
import { NotificationModule } from '../notifications/notification.module';
@Module({
  imports: [
    NotificationModule,
    TypeOrmModule.forFeature([
      AiUsageEventEntity,
      BillingSubscriptionEntity,
      CustomerEntity,
      MarginAlertEntity,
      MarginSnapshotEntity,
      OrganizationEntity,
    ]),
  ],
  providers: [MarginCalculator, MarginRepository, MarginService],
  exports: [MarginCalculator, MarginRepository, MarginService],
})
export class MarginModule {}
