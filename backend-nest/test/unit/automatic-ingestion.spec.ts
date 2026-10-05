import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AiProvider } from '../../src/common/enums/domain.enums';
import {
  createApiKey,
  hashApiKey,
  parseKeyId,
  verifyApiKey,
} from '../../src/modules/ai-usage/api-keys/api-key.crypto';
import { INGESTION_LIMITS } from '../../src/modules/ai-usage/constants/ingestion.constants';
import { ProductionUsageDto } from '../../src/modules/ai-usage/dto/production-usage.dto';
import { OpenAiCostCalculator } from '../../src/modules/ai-usage/pricing/openai/openai-cost.calculator';
import { OPENAI_PRICING_VERSION } from '../../src/modules/ai-usage/pricing/openai/openai-pricing.catalog';

describe('automatic usage ingestion primitives', () => {
  it('generates recognizable random keys and verifies only the correct one-way hash', async () => {
    const first = createApiKey();
    const second = createApiKey();
    expect(first.secret).toMatch(/^mtr_live_/);
    expect(first.secret).not.toBe(second.secret);
    expect(parseKeyId(first.secret)).toBe(first.keyId);
    expect(parseKeyId(first.secret.replace(/^mtr_live_/, 'mos_live_'))).toBeNull();
    const hash = await hashApiKey(first.secret);
    expect(hash).not.toContain(first.secret);
    expect(await verifyApiKey(first.secret, hash)).toBe(true);
    expect(await verifyApiKey(second.secret, hash)).toBe(false);
  });
  it.each([
    ['input only', 1_000_000, 0, '1.250000'],
    ['output only', 0, 1_000_000, '10.000000'],
    ['combined precise', 1200, 350, '0.005000'],
    ['sub-cent precision', 1, 1, '0.000011'],
  ])('calculates GPT-5 %s cost with Decimal', (_name, inputTokens, outputTokens, expected) => {
    const result = new OpenAiCostCalculator().calculate({
      provider: AiProvider.OpenAI,
      model: 'gpt-5',
      inputTokens,
      outputTokens,
    });
    expect(result.cost).toBe(expected);
    expect(result.currency).toBe('USD');
    expect(result.pricingVersion).toBe(OPENAI_PRICING_VERSION);
  });
  it('rejects unknown models instead of guessing', () => {
    expect(() =>
      new OpenAiCostCalculator().calculate({
        provider: AiProvider.OpenAI,
        model: 'unknown',
        inputTokens: 1,
        outputTokens: 1,
      }),
    ).toThrow('no pricing catalog entry');
  });
  it('validates explicit decimal cost, token bounds, provider, and timestamp shape', async () => {
    const base = {
      externalRequestId: 'req',
      customerId: 'customer',
      provider: 'openai',
      model: 'gpt-5',
      usage: { inputTokens: 1, outputTokens: 2 },
      occurredAt: new Date().toISOString(),
    };
    expect(
      await validate(
        plainToInstance(ProductionUsageDto, { ...base, cost: '1.234567', currency: 'USD' }),
      ),
    ).toHaveLength(0);
    expect(
      (
        await validate(
          plainToInstance(ProductionUsageDto, { ...base, cost: '-1', currency: 'USD' }),
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await validate(
          plainToInstance(ProductionUsageDto, {
            ...base,
            usage: { inputTokens: INGESTION_LIMITS.tokens + 1, outputTokens: 0 },
          }),
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (await validate(plainToInstance(ProductionUsageDto, { ...base, provider: 'anthropic' })))
        .length,
    ).toBeGreaterThan(0);
    expect(
      (await validate(plainToInstance(ProductionUsageDto, { ...base, occurredAt: 'tomorrowish' })))
        .length,
    ).toBeGreaterThan(0);
  });
  it('enforces reusable string bounds in the normalized DTO', async () => {
    const value = plainToInstance(ProductionUsageDto, {
      externalRequestId: 'x'.repeat(INGESTION_LIMITS.externalRequestId + 1),
      customerId: 'c',
      provider: 'openai',
      model: 'gpt-5',
      feature: 'f'.repeat(INGESTION_LIMITS.feature + 1),
      usage: { inputTokens: 0, outputTokens: 0 },
      occurredAt: new Date().toISOString(),
    });
    expect((await validate(value)).length).toBeGreaterThanOrEqual(2);
  });
});
