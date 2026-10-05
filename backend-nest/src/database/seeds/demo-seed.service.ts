import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import {
  AiCostSource,
  AiProvider,
  RevenueSource,
  StripeCustomerStatus,
} from '../../common/enums/domain.enums';
import { AiUsageEventEntity, CustomerEntity, UserEntity } from '../entities';
import { AuthRepository } from '../../modules/auth/repositories/auth.repository';
import { MarginService } from '../../modules/margin/services/margin.service';

@Injectable()
export class DemoSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DemoSeedService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly auth: AuthRepository,
    private readonly margins: MarginService,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(CustomerEntity)
    private readonly customers: Repository<CustomerEntity>,
    @InjectRepository(AiUsageEventEntity)
    private readonly usage: Repository<AiUsageEventEntity>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get<string>('app.environment')?.toLowerCase() === 'production') return;
    if (!this.config.get<boolean>('app.seedDemoData')) return;
    const email = 'demo@margintra.local';
    if (await this.users.existsBy({ email })) return;
    const passwordHash = await bcrypt.hash('Demo123!', 12);
    const { organization } = await this.auth.register(email, passwordHash, 'Acme AI');
    const now = new Date();
    const definitions = [
      ['demo_healthy', 'Healthy Co', 'billing@healthy.example', '99', '10'],
      ['demo_risk', 'At Risk Labs', 'billing@risk.example', '99', '40'],
      ['demo_critical', 'Critical AI', 'billing@critical.example', '49', '55'],
    ] as const;
    for (const [externalCustomerId, name, customerEmail, revenue, cost] of definitions) {
      const customer = await this.customers.save(
        this.customers.create({
          id: randomUUID(),
          organizationId: organization.id,
          externalCustomerId,
          name,
          email: customerEmail,
          monthlyRevenue: revenue,
          manualMonthlyRevenue: revenue,
          revenueSource: RevenueSource.Manual,
          stripeCustomerId: null,
          stripeCustomerStatus: StripeCustomerStatus.Unknown,
          revenueUpdatedAt: now,
          revenueStale: false,
          currency: 'USD',
          createdAt: now,
          updatedAt: now,
        }),
      );
      await this.usage.save(
        this.usage.create({
          id: randomUUID(),
          organizationId: organization.id,
          customerId: customer.id,
          provider: AiProvider.OpenAI,
          model: 'gpt-5',
          feature: 'document_summary',
          inputTokens: '2500',
          outputTokens: '500',
          cost,
          currency: 'USD',
          costSource: AiCostSource.Explicit,
          pricingVersion: null,
          pricingModel: null,
          metadata: {},
          externalRequestId: `demo_usage_${externalCustomerId}`,
          occurredAt: now,
          createdAt: now,
        }),
      );
      await this.margins.recalculate(organization.id, customer.id);
    }
    this.logger.log({ event: 'DemoDataSeeded', organizationId: organization.id });
  }
}
