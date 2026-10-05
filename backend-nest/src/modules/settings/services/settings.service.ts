import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrganizationRole } from '../../../common/enums/domain.enums';
import { ForbiddenError } from '../../../common/errors/application.error';
import { decimalNumber, decimalString } from '../../../common/helpers/decimal-response.helper';
import { OrganizationEntity, OrganizationMemberEntity } from '../../../database/entities';
import { MarginRepository } from '../../margin/repositories/margin.repository';
import { MarginService } from '../../margin/services/margin.service';
import { ValidationError } from '../../../common/errors/application.error';
import { UpdateMarginSettingsDto } from '../dto/settings.dto';
import { GuardrailHistoryService } from '../../guardrail-history/guardrail-history.service';
@Injectable()
export class SettingsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly repository: MarginRepository,
    private readonly margins: MarginService,
    private readonly history: GuardrailHistoryService,
  ) {}
  async get(org: string) {
    const organization = await this.dataSource.manager.findOneByOrFail(OrganizationEntity, {
      id: org,
    });
    return this.response(organization);
  }
  async update(org: string, userId: string, dto: UpdateMarginSettingsDto) {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`P${org}`]);
      const member = await manager.findOneBy(OrganizationMemberEntity, {
        organizationId: org,
        userId,
      });
      if (!member || ![OrganizationRole.Owner, OrganizationRole.Admin].includes(member.role))
        throw new ForbiddenError('Owner or admin role is required.');
      const organization = await manager.findOneByOrFail(OrganizationEntity, { id: org });
      const warning = dto.warningThreshold ?? Number(organization.budgetWarningThreshold);
      const critical = dto.criticalThreshold ?? Number(organization.budgetCriticalThreshold);
      if (warning >= critical)
        throw new ValidationError('Warning threshold must be lower than critical threshold.');
      organization.targetGrossMargin = decimalString(dto.targetGrossMargin, 2);
      organization.budgetWarningThreshold = decimalString(warning, 2);
      organization.budgetCriticalThreshold = decimalString(critical, 2);
      organization.updatedAt = new Date();
      await manager.save(organization);
      await this.history.recordOrganization(organization, organization.updatedAt, manager);
      for (const customer of await this.repository.customers(org, manager))
        await this.margins.recalculate(org, customer.id, manager);
      return this.response(organization);
    });
  }
  private response(organization: OrganizationEntity) {
    return {
      targetGrossMargin: decimalNumber(organization.targetGrossMargin),
      warningThreshold: decimalNumber(organization.budgetWarningThreshold),
      criticalThreshold: decimalNumber(organization.budgetCriticalThreshold),
    };
  }
}
