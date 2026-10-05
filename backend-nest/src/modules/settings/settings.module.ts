import { Module } from '@nestjs/common';
import { MarginModule } from '../margin/margin.module';
import { SettingsController } from './controllers/settings.controller';
import { SettingsService } from './services/settings.service';
import { GuardrailHistoryModule } from '../guardrail-history/guardrail-history.module';
@Module({
  imports: [MarginModule, GuardrailHistoryModule],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
