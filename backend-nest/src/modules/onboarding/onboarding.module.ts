import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AiUsageEventEntity,
  CustomerEntity,
  IngestionApiKeyEntity,
  OrganizationEntity,
  StripeConnectionEntity,
} from '../../database/entities';
import { OnboardingController } from './onboarding.controller';
import { OnboardingRepository } from './onboarding.repository';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrganizationEntity,
      StripeConnectionEntity,
      IngestionApiKeyEntity,
      AiUsageEventEntity,
      CustomerEntity,
    ]),
  ],
  controllers: [OnboardingController],
  providers: [OnboardingRepository, OnboardingService],
})
export class OnboardingModule {}
