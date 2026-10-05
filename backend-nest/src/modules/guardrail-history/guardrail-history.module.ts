import { Module } from '@nestjs/common';
import { GuardrailHistoryService } from './guardrail-history.service';

@Module({ providers: [GuardrailHistoryService], exports: [GuardrailHistoryService] })
export class GuardrailHistoryModule {}
