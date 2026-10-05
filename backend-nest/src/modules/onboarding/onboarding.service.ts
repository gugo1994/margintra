import { ConflictException, Injectable } from '@nestjs/common';
import { OnboardingRepository } from './onboarding.repository';

export type OnboardingStatus = 'not_started' | 'in_progress' | 'completed';

export interface OnboardingState {
  onboardingStatus: OnboardingStatus;
  requiresOnboarding: boolean;
  stripeConnected: boolean;
  ingestionKeyCreated: boolean;
  firstUsageReceived: boolean;
  customerCount: number;
  usageEventCount: number;
  startedAt: string | null;
  completedAt: string | null;
}

@Injectable()
export class OnboardingService {
  constructor(private readonly repository: OnboardingRepository) {}

  async getStatus(organizationId: string): Promise<OnboardingState> {
    const [organization, stripeConnected, ingestionKeyCreated, usageEventCount, customerCount] =
      await Promise.all([
        this.repository.findOrganization(organizationId),
        this.repository.hasConnectedStripe(organizationId),
        this.repository.hasActiveIngestionKey(organizationId),
        this.repository.countUsageEvents(organizationId),
        this.repository.countCustomers(organizationId),
      ]);
    const firstUsageReceived = usageEventCount > 0;
    const allStepsComplete = stripeConnected && ingestionKeyCreated && firstUsageReceived;
    const legacyConfigured = organization.onboardingStartedAt === null && allStepsComplete;
    const completed = organization.onboardingCompletedAt !== null || legacyConfigured;
    const started =
      organization.onboardingStartedAt !== null ||
      stripeConnected ||
      ingestionKeyCreated ||
      firstUsageReceived;

    return {
      onboardingStatus: completed ? 'completed' : started ? 'in_progress' : 'not_started',
      requiresOnboarding: !completed,
      stripeConnected,
      ingestionKeyCreated,
      firstUsageReceived,
      customerCount,
      usageEventCount,
      startedAt: organization.onboardingStartedAt?.toISOString() ?? null,
      completedAt: organization.onboardingCompletedAt?.toISOString() ?? null,
    };
  }

  async start(organizationId: string): Promise<OnboardingState> {
    const organization = await this.repository.findOrganization(organizationId);
    if (!organization.onboardingStartedAt && !organization.onboardingCompletedAt) {
      organization.onboardingStartedAt = new Date();
      organization.updatedAt = new Date();
      await this.repository.saveOrganization(organization);
    }
    return this.getStatus(organizationId);
  }

  async complete(organizationId: string): Promise<OnboardingState> {
    const state = await this.getStatus(organizationId);
    if (!state.stripeConnected || !state.ingestionKeyCreated) {
      throw new ConflictException('Complete Stripe and ingestion key steps first.');
    }
    const organization = await this.repository.findOrganization(organizationId);
    if (!organization.onboardingCompletedAt) {
      const now = new Date();
      organization.onboardingStartedAt ??= now;
      organization.onboardingCompletedAt = now;
      organization.updatedAt = now;
      await this.repository.saveOrganization(organization);
    }
    return this.getStatus(organizationId);
  }
}
