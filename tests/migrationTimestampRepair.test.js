import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import {
  inspectTimestampMaps,
  isTimestampMap,
  restoreTimestamps
} from '../scripts/migrationTimestampRepair.js';
import { rewriteHistoricalReferences, rewriteProductReferences } from '../scripts/productIdMigration.js';

describe('migration timestamp repair', () => {
  it('recognizes legacy timestamp maps and restores them as Firestore Timestamps', () => {
    const legacy = { _seconds: 1_770_175_033, _nanoseconds: 755_000_000 };
    expect(isTimestampMap(legacy)).toBe(true);
    const matches = [];
    const repaired = restoreTimestamps({ created_at: legacy, nested: [{ updated_at: legacy }] }, '', matches);

    expect(repaired.created_at).toBeInstanceOf(Timestamp);
    expect(repaired.created_at.seconds).toBe(1_770_175_033);
    expect(repaired.nested[0].updated_at).toBeInstanceOf(Timestamp);
    expect(matches).toHaveLength(2);
  });

  it('does not rewrite real Firestore Timestamp values', () => {
    const timestamp = Timestamp.fromMillis(1_770_175_033_755);
    const value = { created_at: timestamp, product_id: 'OLD' };
    const mapping = new Map([['OLD', 'NEW_AB12']]);

    expect(rewriteProductReferences(value, mapping).created_at).toBe(timestamp);
    expect(rewriteHistoricalReferences(value, mapping).created_at).toBe(timestamp);
  });

  it('reports affected documents without changing document counts', () => {
    const report = inspectTimestampMaps([
      { id: 'A', data: { created_at: { _seconds: 1, _nanoseconds: 2 } } },
      { id: 'B', data: { created_at: Timestamp.fromMillis(1000) } }
    ]);

    expect(report.documents).toBe(2);
    expect(report.documentsWithTimestampMaps).toBe(1);
    expect(report.timestampMaps).toBe(1);
    expect(report.changedDocuments[0].id).toBe('A');
  });
});
