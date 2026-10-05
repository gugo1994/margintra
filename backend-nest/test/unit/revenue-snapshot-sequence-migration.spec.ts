import { QueryRunner } from 'typeorm';
import { RevenueSnapshotSequence1787738300000 } from '../../src/database/migrations/1787738300000-RevenueSnapshotSequence';

describe('revenue snapshot sequence migration', () => {
  it('backfills deterministic ordering without rewriting historical financial facts', async () => {
    const runner = { query: jest.fn().mockResolvedValue(undefined) } as unknown as QueryRunner;

    await new RevenueSnapshotSequence1787738300000().up(runner);

    const sql = String((runner.query as jest.Mock).mock.calls[0][0]);
    expect(sql).toContain('ROW_NUMBER() OVER');
    expect(sql).toContain('ORDER BY "EffectiveFrom", "CreatedAt", "Id"');
    expect(sql).toContain('WHERE snapshot."Id"=ordered."Id" AND snapshot."Sequence" IS NULL');
    expect(sql).toContain('IDX_revenue_history_customer_sequence');
    expect(sql).toContain('IDX_revenue_history_point_in_time');
    expect(sql).not.toContain('SET "Revenue"');
    expect(sql).not.toContain('SET "Currency"');
    expect(sql).not.toContain('SET "EffectiveFrom"');
    expect(sql).not.toContain('DELETE FROM "customer_revenue_snapshots"');
  });
});
