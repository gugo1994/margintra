import { AiProvider } from '../../../common/enums/domain.enums';
import { PricingRefreshService } from './pricing-refresh.service';

export const runPricingRefreshCommand = async (
  service: Pick<PricingRefreshService, 'refresh'>,
  provider: AiProvider,
) => {
  const result = await service.refresh(provider);
  return {
    checked: result.checked,
    unchanged: result.unchanged,
    'pending-created': result.pendingCreated,
    unavailable: result.unavailable,
  };
};
