import { Injectable } from '@nestjs/common';
import { RevenueSource, StripeCustomerStatus } from '../../../common/enums/domain.enums';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../common/errors/application.error';
import { decimalNumber, decimalString } from '../../../common/helpers/decimal-response.helper';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  UpdateCustomerGuardrailsDto,
} from '../dto/customer.dto';
import { OrganizationEntity } from '../../../database/entities';
import { CustomerRepository } from '../repositories/customer.repository';
import { MarginService } from '../../margin/services/margin.service';
import { RevenueHistoryService } from '../../revenue-history/revenue-history.service';
import { GuardrailHistoryService } from '../../guardrail-history/guardrail-history.service';
@Injectable()
export class CustomerService {
  constructor(
    private readonly repository: CustomerRepository,
    private readonly margins: MarginService,
    private readonly revenueHistory: RevenueHistoryService,
    private readonly guardrailHistory: GuardrailHistoryService,
  ) {}
  async list(org: string) {
    return (await this.repository.list(org)).map((x) => this.map(x));
  }
  async get(org: string, id: string) {
    const customer = await this.repository.find(org, id);
    if (!customer) throw new NotFoundError();
    return this.map(customer);
  }
  async create(org: string, dto: CreateCustomerDto) {
    try {
      return await this.repository.transaction(async (manager) => {
        const now = new Date();
        const customer = this.repository.create(
          {
            organizationId: org,
            externalCustomerId: dto.externalCustomerId.trim(),
            name: dto.name.trim(),
            email: dto.email?.trim() || null,
            monthlyRevenue: decimalString(dto.monthlyRevenue, 2),
            manualMonthlyRevenue: decimalString(dto.monthlyRevenue, 2),
            revenueSource: RevenueSource.Manual,
            stripeCustomerId: null,
            stripeCustomerStatus: StripeCustomerStatus.Unknown,
            revenueUpdatedAt: now,
            revenueStale: false,
            currency: dto.currency.toUpperCase(),
            targetGrossMarginOverride: null,
            budgetWarningThresholdOverride: null,
            budgetCriticalThresholdOverride: null,
            createdAt: now,
            updatedAt: now,
          },
          manager,
        );
        await this.repository.save(customer, manager);
        await this.revenueHistory.recordIfChanged(
          org,
          customer.id,
          customer.monthlyRevenue,
          customer.currency,
          now,
          manager,
        );
        await this.guardrailHistory.recordCustomer(customer, now, manager);
        return this.map(customer);
      });
    } catch {
      throw new ConflictError('External customer ID must be unique within the organization.');
    }
  }
  async update(org: string, id: string, dto: UpdateCustomerDto) {
    return this.repository.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`C${org}${id}`]);
      const customer = await this.repository.find(org, id, manager);
      if (!customer) throw new NotFoundError();
      if (
        customer.revenueSource === RevenueSource.Stripe &&
        (decimalString(dto.monthlyRevenue, 2) !== decimalString(customer.monthlyRevenue, 2) ||
          dto.currency.toUpperCase() !== customer.currency)
      )
        throw new ConflictError(
          'Synchronize Stripe to change revenue or currency for this customer.',
        );
      Object.assign(customer, {
        externalCustomerId: dto.externalCustomerId.trim(),
        name: dto.name.trim(),
        email: dto.email?.trim() || null,
        updatedAt: new Date(),
      });
      if (customer.revenueSource === RevenueSource.Manual)
        Object.assign(customer, {
          monthlyRevenue: decimalString(dto.monthlyRevenue, 2),
          manualMonthlyRevenue: decimalString(dto.monthlyRevenue, 2),
          currency: dto.currency.toUpperCase(),
          revenueUpdatedAt: new Date(),
          revenueStale: false,
        });
      await this.repository.save(customer, manager);
      await this.revenueHistory.recordIfChanged(
        org,
        customer.id,
        customer.monthlyRevenue,
        customer.currency,
        customer.revenueUpdatedAt ?? new Date(),
        manager,
      );
      await this.margins.recalculate(org, id, manager);
      return this.map(customer);
    });
  }
  async updateGuardrails(org: string, id: string, dto: UpdateCustomerGuardrailsDto) {
    return this.repository.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`C${org}${id}`]);
      const customer = await this.repository.find(org, id, manager);
      if (!customer) throw new NotFoundError();
      const organization = await manager.findOneByOrFail(OrganizationEntity, { id: org });
      const target =
        dto.targetGrossMargin === undefined
          ? customer.targetGrossMarginOverride === null
            ? null
            : Number(customer.targetGrossMarginOverride)
          : dto.targetGrossMargin;
      const warning =
        dto.warningThreshold === undefined
          ? customer.budgetWarningThresholdOverride === null
            ? null
            : Number(customer.budgetWarningThresholdOverride)
          : dto.warningThreshold;
      const critical =
        dto.criticalThreshold === undefined
          ? customer.budgetCriticalThresholdOverride === null
            ? null
            : Number(customer.budgetCriticalThresholdOverride)
          : dto.criticalThreshold;
      const effectiveWarning = warning ?? Number(organization.budgetWarningThreshold);
      const effectiveCritical = critical ?? Number(organization.budgetCriticalThreshold);
      if (
        (target !== null && target >= 100) ||
        effectiveWarning >= effectiveCritical ||
        effectiveCritical > 100
      )
        throw new ValidationError('Guardrail thresholds are invalid.');
      customer.targetGrossMarginOverride = target === null ? null : decimalString(target, 2);
      customer.budgetWarningThresholdOverride = warning === null ? null : decimalString(warning, 2);
      customer.budgetCriticalThresholdOverride =
        critical === null ? null : decimalString(critical, 2);
      customer.updatedAt = new Date();
      await this.repository.save(customer, manager);
      await this.guardrailHistory.recordCustomer(customer, customer.updatedAt, manager);
      await this.margins.recalculate(org, id, manager);
      return {
        targetGrossMarginOverride:
          customer.targetGrossMarginOverride === null
            ? null
            : decimalNumber(customer.targetGrossMarginOverride),
        warningThresholdOverride:
          customer.budgetWarningThresholdOverride === null
            ? null
            : decimalNumber(customer.budgetWarningThresholdOverride),
        criticalThresholdOverride:
          customer.budgetCriticalThresholdOverride === null
            ? null
            : decimalNumber(customer.budgetCriticalThresholdOverride),
      };
    });
  }
  private map(x: import('../../../database/entities').CustomerEntity) {
    return {
      id: x.id,
      externalCustomerId: x.externalCustomerId,
      name: x.name,
      email: x.email,
      monthlyRevenue: decimalNumber(x.monthlyRevenue),
      currency: x.currency,
      revenueSource: x.revenueSource === RevenueSource.Stripe ? 'stripe' : 'manual',
      stripeCustomerId: x.stripeCustomerId,
      revenueStale: x.revenueStale,
      revenueUpdatedAt: x.revenueUpdatedAt?.toISOString() ?? null,
      stripeCustomerStatus:
        x.stripeCustomerStatus === StripeCustomerStatus.Active
          ? 'active'
          : x.stripeCustomerStatus === StripeCustomerStatus.Deleted
            ? 'deleted'
            : 'unknown',
    };
  }
}
