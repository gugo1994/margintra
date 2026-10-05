import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { EntityManager } from 'typeorm';
import {
  CustomerEntity,
  CustomerGuardrailVersionEntity,
  OrganizationEntity,
  OrganizationGuardrailVersionEntity,
} from '../../database/entities';

@Injectable()
export class GuardrailHistoryService {
  async recordOrganization(
    organization: OrganizationEntity,
    effectiveFrom: Date,
    manager: EntityManager,
  ) {
    const latest = await manager.findOne(OrganizationGuardrailVersionEntity, {
      where: { organizationId: organization.id },
      order: { effectiveFrom: 'DESC', createdAt: 'DESC' },
    });
    if (
      latest &&
      new Decimal(latest.targetGrossMargin).eq(organization.targetGrossMargin) &&
      new Decimal(latest.warningThreshold).eq(organization.budgetWarningThreshold) &&
      new Decimal(latest.criticalThreshold).eq(organization.budgetCriticalThreshold)
    )
      return latest;
    return manager.save(
      manager.create(OrganizationGuardrailVersionEntity, {
        id: randomUUID(),
        organizationId: organization.id,
        targetGrossMargin: organization.targetGrossMargin,
        warningThreshold: organization.budgetWarningThreshold,
        criticalThreshold: organization.budgetCriticalThreshold,
        effectiveFrom: this.monotonic(effectiveFrom, latest?.effectiveFrom),
        createdAt: new Date(),
      }),
    );
  }

  async recordCustomer(customer: CustomerEntity, effectiveFrom: Date, manager: EntityManager) {
    const latest = await manager.findOne(CustomerGuardrailVersionEntity, {
      where: { organizationId: customer.organizationId, customerId: customer.id },
      order: { effectiveFrom: 'DESC', createdAt: 'DESC' },
    });
    if (
      latest &&
      this.equalNullable(latest.targetGrossMarginOverride, customer.targetGrossMarginOverride) &&
      this.equalNullable(
        latest.warningThresholdOverride,
        customer.budgetWarningThresholdOverride,
      ) &&
      this.equalNullable(latest.criticalThresholdOverride, customer.budgetCriticalThresholdOverride)
    )
      return latest;
    return manager.save(
      manager.create(CustomerGuardrailVersionEntity, {
        id: randomUUID(),
        organizationId: customer.organizationId,
        customerId: customer.id,
        targetGrossMarginOverride: customer.targetGrossMarginOverride,
        warningThresholdOverride: customer.budgetWarningThresholdOverride,
        criticalThresholdOverride: customer.budgetCriticalThresholdOverride,
        effectiveFrom: this.monotonic(effectiveFrom, latest?.effectiveFrom),
        createdAt: new Date(),
      }),
    );
  }

  private equalNullable(left: string | null, right: string | null) {
    return left === null || right === null ? left === right : new Decimal(left).eq(right);
  }
  private monotonic(value: Date, latest?: Date) {
    return latest && value <= latest ? new Date(latest.getTime() + 1) : value;
  }
}
