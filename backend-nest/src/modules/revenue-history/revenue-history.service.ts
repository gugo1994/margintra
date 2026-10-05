import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { EntityManager } from 'typeorm';
import { CustomerRevenueSnapshotEntity } from '../../database/entities';
import { decimalString } from '../../common/helpers/decimal-response.helper';

@Injectable()
export class RevenueHistoryService {
  async recordIfChanged(
    organizationId: string,
    customerId: string,
    revenue: Decimal.Value,
    currency: string,
    effectiveFrom: Date,
    manager: EntityManager,
  ) {
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `C${organizationId}${customerId}`,
    ]);
    const latest = await manager.findOne(CustomerRevenueSnapshotEntity, {
      where: { organizationId, customerId },
      order: { effectiveFrom: 'DESC', sequence: 'DESC' },
    });
    const normalizedRevenue = decimalString(revenue, 6);
    const normalizedCurrency = currency.toUpperCase();
    if (
      latest &&
      new Decimal(latest.revenue).eq(normalizedRevenue) &&
      latest.currency === normalizedCurrency
    )
      return latest;
    const sequenceRows = await manager.query<Array<{ nextSequence: number }>>(
      `SELECT COALESCE(MAX("Sequence"),0)+1 AS "nextSequence"
       FROM "customer_revenue_snapshots"
       WHERE "OrganizationId"=$1 AND "CustomerId"=$2`,
      [organizationId, customerId],
    );
    const nextSequence = sequenceRows[0]?.nextSequence;
    if (nextSequence === undefined) throw new Error('Revenue snapshot sequence was unavailable.');
    return manager.save(
      manager.create(CustomerRevenueSnapshotEntity, {
        id: randomUUID(),
        organizationId,
        customerId,
        revenue: normalizedRevenue,
        currency: normalizedCurrency,
        effectiveFrom,
        sequence: nextSequence,
        createdAt: new Date(),
      }),
    );
  }
}
