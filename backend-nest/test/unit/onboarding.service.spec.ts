import { ConflictException } from '@nestjs/common';
import { OrganizationEntity } from '../../src/database/entities';
import { OnboardingRepository } from '../../src/modules/onboarding/onboarding.repository';
import { OnboardingService } from '../../src/modules/onboarding/onboarding.service';

describe('OnboardingService', () => {
  const organization = (): OrganizationEntity => ({
    id: 'org-a',
    name: 'A',
    targetGrossMargin: '70',
    budgetWarningThreshold: '80',
    budgetCriticalThreshold: '100',
    reportingCurrency: 'USD',
    onboardingStartedAt: null,
    onboardingCompletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });

  function setup(
    overrides: {
      stripe?: boolean;
      key?: boolean;
      usage?: number;
      customers?: number;
      org?: OrganizationEntity;
    } = {},
  ) {
    const org = overrides.org ?? organization();
    const repository = {
      findOrganization: jest.fn().mockResolvedValue(org),
      hasConnectedStripe: jest.fn().mockResolvedValue(overrides.stripe ?? false),
      hasActiveIngestionKey: jest.fn().mockResolvedValue(overrides.key ?? false),
      countUsageEvents: jest.fn().mockResolvedValue(overrides.usage ?? 0),
      countCustomers: jest.fn().mockResolvedValue(overrides.customers ?? 0),
      saveOrganization: jest.fn().mockResolvedValue(org),
    } as unknown as jest.Mocked<OnboardingRepository>;
    return { service: new OnboardingService(repository), repository, org };
  }

  it('calculates a new organization as not started', async () => {
    const { service } = setup();
    await expect(service.getStatus('org-a')).resolves.toMatchObject({
      onboardingStatus: 'not_started',
      requiresOnboarding: true,
      stripeConnected: false,
      ingestionKeyCreated: false,
      firstUsageReceived: false,
      customerCount: 0,
      usageEventCount: 0,
    });
  });

  it('does not force a preconfigured existing organization through onboarding', async () => {
    const { service } = setup({ stripe: true, key: true, usage: 4, customers: 2 });
    await expect(service.getStatus('org-a')).resolves.toMatchObject({
      onboardingStatus: 'completed',
      requiresOnboarding: false,
      completedAt: null,
    });
  });

  it('keeps a started organization in progress until explicit completion', async () => {
    const org = organization();
    org.onboardingStartedAt = new Date('2026-02-01T00:00:00Z');
    const { service } = setup({ org, stripe: true, key: true, usage: 1 });
    await expect(service.getStatus('org-a')).resolves.toMatchObject({
      onboardingStatus: 'in_progress',
      requiresOnboarding: true,
    });
  });

  it('rejects premature completion', async () => {
    const { service } = setup({ stripe: true, key: true });
    await expect(service.complete('org-a')).rejects.toBeInstanceOf(ConflictException);
  });

  it('persists completion after all derived steps are complete', async () => {
    const org = organization();
    org.onboardingStartedAt = new Date('2026-02-01T00:00:00Z');
    const { service, repository } = setup({ org, stripe: true, key: true, usage: 1 });
    await service.complete('org-a');
    expect(repository.saveOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ onboardingCompletedAt: expect.any(Date) }),
    );
  });

  it('queries every derived fact with only the authenticated organization id', async () => {
    const { service, repository } = setup();
    await service.getStatus('org-a');
    expect(repository.hasConnectedStripe).toHaveBeenCalledWith('org-a');
    expect(repository.hasActiveIngestionKey).toHaveBeenCalledWith('org-a');
    expect(repository.countUsageEvents).toHaveBeenCalledWith('org-a');
    expect(repository.countCustomers).toHaveBeenCalledWith('org-a');
  });
});
