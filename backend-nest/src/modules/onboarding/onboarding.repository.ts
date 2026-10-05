import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AiUsageEventEntity,
  CustomerEntity,
  IngestionApiKeyEntity,
  OrganizationEntity,
  StripeConnectionEntity,
} from '../../database/entities';
import { IngestionApiKeyStatus, StripeConnectionStatus } from '../../common/enums/domain.enums';

@Injectable()
export class OnboardingRepository {
  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly organizations: Repository<OrganizationEntity>,
    @InjectRepository(StripeConnectionEntity)
    private readonly stripeConnections: Repository<StripeConnectionEntity>,
    @InjectRepository(IngestionApiKeyEntity)
    private readonly ingestionKeys: Repository<IngestionApiKeyEntity>,
    @InjectRepository(AiUsageEventEntity)
    private readonly usageEvents: Repository<AiUsageEventEntity>,
    @InjectRepository(CustomerEntity)
    private readonly customers: Repository<CustomerEntity>,
  ) {}

  findOrganization(organizationId: string) {
    return this.organizations.findOneByOrFail({ id: organizationId });
  }

  hasConnectedStripe(organizationId: string) {
    return this.stripeConnections.existsBy({
      organizationId,
      status: StripeConnectionStatus.Connected,
    });
  }

  hasActiveIngestionKey(organizationId: string) {
    return this.ingestionKeys.existsBy({
      organizationId,
      status: IngestionApiKeyStatus.Active,
    });
  }

  countUsageEvents(organizationId: string) {
    return this.usageEvents.countBy({ organizationId });
  }

  countCustomers(organizationId: string) {
    return this.customers.countBy({ organizationId });
  }

  saveOrganization(organization: OrganizationEntity) {
    return this.organizations.save(organization);
  }
}
