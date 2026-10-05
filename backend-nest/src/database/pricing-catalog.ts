import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AiProvider, PricingStatus } from '../common/enums/domain.enums';
import { MetricsService } from '../modules/operations/metrics.service';
import {
  CreateVerifiedPricingCandidateDto,
  PricingVersionActionDto,
} from '../modules/ai-usage/pricing/pricing-operations.dto';
import {
  PricingOperationError,
  PricingOperationsService,
} from '../modules/ai-usage/pricing/pricing-operations.service';
import { PricingCatalogRepository } from '../modules/ai-usage/pricing/pricing-catalog.repository';
import { PricingCatalogSyncService } from '../modules/ai-usage/pricing/pricing-catalog-sync.service';
import { PricingRefreshService } from '../modules/ai-usage/pricing/pricing-refresh.service';
import { OpenAiPricingAdapter } from '../modules/ai-usage/pricing/openai/openai-pricing.adapter';
import { runPricingRefreshCommand } from '../modules/ai-usage/pricing/pricing-refresh-command';
import dataSource from './data-source';

type Arguments = Record<string, string>;

const argumentsFrom = (values: string[]): Arguments => {
  const parsed: Arguments = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith('--') || value === undefined || value.startsWith('--'))
      throw new PricingOperationError('Every option must use --name value syntax.');
    parsed[name.slice(2)] = value;
  }
  return parsed;
};

const validated = async <T extends object>(type: new () => T, value: object): Promise<T> => {
  const dto = plainToInstance(type, value);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length > 0) throw new PricingOperationError('Pricing command validation failed.');
  return dto;
};

const output = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

const main = async () => {
  const command = process.argv[2];
  const options = argumentsFrom(process.argv.slice(3));
  await dataSource.initialize();
  try {
    const repository = new PricingCatalogRepository(dataSource);
    const metrics = new MetricsService();
    const service = new PricingOperationsService(repository, metrics);
    if (command === 'list-active') return output(await service.list(PricingStatus.Active));
    if (command === 'list-pending') return output(await service.list(PricingStatus.Pending));
    if (command === 'create') {
      const dto = await validated(CreateVerifiedPricingCandidateDto, {
        provider: options.provider,
        model: options.model,
        canonicalModel: options['canonical-model'],
        inputPricePerMillion: options['input-price-per-million'],
        outputPricePerMillion: options['output-price-per-million'],
        currency: options.currency,
        effectiveFrom: options['effective-from'],
        sourceType: options['source-type'],
        sourceReference: options['source-reference'],
        operatorSource: options['operator-source'],
      });
      return output(await service.createVerifiedCandidate(dto));
    }
    if (command === 'activate' || command === 'retire') {
      const dto = await validated(PricingVersionActionDto, {
        id: options.id,
        operatorSource: options['operator-source'],
      });
      return output(
        command === 'activate'
          ? await service.activate(dto.id, dto.operatorSource)
          : await service.retire(dto.id, dto.operatorSource),
      );
    }
    if (command === 'refresh') {
      if (!Object.values(AiProvider).includes(options.provider as AiProvider))
        throw new PricingOperationError('A supported --provider is required.');
      const refresh = new PricingRefreshService(
        dataSource,
        new PricingCatalogSyncService(repository, metrics),
        [new OpenAiPricingAdapter()],
        metrics,
      );
      return output(await runPricingRefreshCommand(refresh, options.provider as AiProvider));
    }
    throw new PricingOperationError(
      'Use list-active, list-pending, create, activate, retire, or refresh --provider <provider>.',
    );
  } finally {
    await dataSource.destroy();
  }
};

void main().catch((error: unknown) => {
  const message =
    error instanceof PricingOperationError
      ? error.message
      : 'Pricing command failed. Review server-side database logs using the operation timestamp.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
