import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  OrganizationEntity,
  OrganizationMemberEntity,
  NotificationPreferenceEntity,
  UserEntity,
} from '../../../database/entities';
import { OrganizationRole } from '../../../common/enums/domain.enums';
import { GuardrailHistoryService } from '../../guardrail-history/guardrail-history.service';
@Injectable()
export class AuthRepository {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(OrganizationMemberEntity)
    private readonly members: Repository<OrganizationMemberEntity>,
    private readonly dataSource: DataSource,
    private readonly guardrailHistory: GuardrailHistoryService,
  ) {}
  findUserByEmail(email: string) {
    return this.users.findOneBy({ email });
  }
  async membershipExists(userId: string, organizationId: string) {
    return this.members.existsBy({ userId, organizationId });
  }
  findFirstMembership(userId: string) {
    return this.members.findOne({ where: { userId }, order: { createdAt: 'ASC' } });
  }
  async register(email: string, passwordHash: string, organizationName: string) {
    return this.dataSource.transaction(async (manager) => {
      const now = new Date();
      const user = manager.create(UserEntity, {
        id: randomUUID(),
        email,
        passwordHash,
        createdAt: now,
        updatedAt: now,
      });
      const organization = manager.create(OrganizationEntity, {
        id: randomUUID(),
        name: organizationName,
        targetGrossMargin: '70',
        budgetWarningThreshold: '80',
        budgetCriticalThreshold: '100',
        reportingCurrency: 'USD',
        onboardingStartedAt: null,
        onboardingCompletedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      await manager.save([user, organization]);
      await this.guardrailHistory.recordOrganization(organization, now, manager);
      await manager.save(
        manager.create(NotificationPreferenceEntity, {
          id: randomUUID(),
          organizationId: organization.id,
          emailEnabled: false,
          warningAlertsEnabled: true,
          criticalAlertsEnabled: true,
          recoveryAlertsEnabled: true,
          recipients: [],
          createdAt: now,
          updatedAt: now,
        }),
      );
      await manager.save(
        manager.create(OrganizationMemberEntity, {
          id: randomUUID(),
          userId: user.id,
          organizationId: organization.id,
          role: OrganizationRole.Owner,
          createdAt: now,
        }),
      );
      return { user, organization };
    });
  }
}
