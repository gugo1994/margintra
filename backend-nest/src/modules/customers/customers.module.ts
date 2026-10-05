import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerEntity, StripeConnectionEntity } from '../../database/entities';
import { MarginModule } from '../margin/margin.module';
import { CustomerController } from './controllers/customer.controller';
import { CustomerRepository } from './repositories/customer.repository';
import { CustomerService } from './services/customer.service';
import { RevenueHistoryModule } from '../revenue-history/revenue-history.module';
import { GuardrailHistoryModule } from '../guardrail-history/guardrail-history.module';
@Module({
  imports: [
    TypeOrmModule.forFeature([CustomerEntity, StripeConnectionEntity]),
    MarginModule,
    RevenueHistoryModule,
    GuardrailHistoryModule,
  ],
  controllers: [CustomerController],
  providers: [CustomerRepository, CustomerService],
  exports: [CustomerRepository, CustomerService],
})
export class CustomersModule {}
