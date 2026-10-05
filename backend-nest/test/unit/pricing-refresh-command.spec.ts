import { AiProvider } from '../../src/common/enums/domain.enums';
import { runPricingRefreshCommand } from '../../src/modules/ai-usage/pricing/pricing-refresh-command';

describe('pricing refresh CLI command', () => {
  it('delegates to the canonical refresh service and formats its concise result', async () => {
    const refresh = jest
      .fn()
      .mockResolvedValue({
        provider: AiProvider.OpenAI,
        checked: 4,
        unchanged: 2,
        pendingCreated: 2,
        unavailable: false,
        busy: false,
      });
    await expect(runPricingRefreshCommand({ refresh }, AiProvider.OpenAI)).resolves.toEqual({
      checked: 4,
      unchanged: 2,
      'pending-created': 2,
      unavailable: false,
    });
    expect(refresh).toHaveBeenCalledWith(AiProvider.OpenAI);
  });
});
