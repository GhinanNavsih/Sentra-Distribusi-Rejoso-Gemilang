import { describe, expect, it } from 'vitest';
import {
  aggregateByPosItem,
  computeNetDeltas,
  resolveDeliveryLines
} from '../functions/shared/posDeliveryMath.js';

const line = (overrides = {}) => ({
  product_id: 'GP_1234',
  product_name: 'Gula Pasir',
  base_qty: 5,
  base_unit: 'kg',
  ...overrides
});

describe('resolveDeliveryLines', () => {
  it('blocks a product with no link at all', () => {
    const [resolved] = resolveDeliveryLines([line()], {});
    expect(resolved.blocked).toBe('unmapped');
    expect(resolved.posItemId).toBeNull();
  });

  it('blocks a product whose unit changed since the link was made', () => {
    const links = { GP_1234: { inventoryItemId: 'Gula_1', sdrgBaseUnit: 'gram' } };
    const [resolved] = resolveDeliveryLines([line({ base_unit: 'kg' })], links);
    expect(resolved.blocked).toBe('unit_drift');
  });

  it('resolves cleanly when linked and units match, case/whitespace-insensitively', () => {
    const links = { GP_1234: { inventoryItemId: 'Gula_1', sdrgBaseUnit: ' KG ' } };
    const [resolved] = resolveDeliveryLines([line({ base_unit: 'kg' })], links);
    expect(resolved.blocked).toBeNull();
    expect(resolved.posItemId).toBe('Gula_1');
  });
});

describe('aggregateByPosItem', () => {
  it('sums two SDRG products that map to the same POS item', () => {
    const resolved = resolveDeliveryLines(
      [line({ product_id: 'A', base_qty: 5 }), line({ product_id: 'B', base_qty: 3 })],
      {
        A: { inventoryItemId: 'Beras_1', sdrgBaseUnit: 'kg' },
        B: { inventoryItemId: 'Beras_1', sdrgBaseUnit: 'kg' }
      }
    );
    const result = aggregateByPosItem(resolved);
    expect(result.quantities).toEqual({ Beras_1: 8 });
    expect(result.hasFractional).toBe(false);
  });

  it('accepts fractional halves that total a whole once combined', () => {
    const resolved = resolveDeliveryLines(
      [line({ product_id: 'A', base_qty: 2.5 }), line({ product_id: 'B', base_qty: 2.5 })],
      {
        A: { inventoryItemId: 'Beras_1', sdrgBaseUnit: 'kg' },
        B: { inventoryItemId: 'Beras_1', sdrgBaseUnit: 'kg' }
      }
    );
    expect(aggregateByPosItem(resolved).quantities).toEqual({ Beras_1: 5 });
  });

  it('flags a total that is not a whole number rather than rounding it', () => {
    const resolved = resolveDeliveryLines(
      [line({ base_qty: 2.5 })],
      { GP_1234: { inventoryItemId: 'Gula_1', sdrgBaseUnit: 'kg' } }
    );
    const result = aggregateByPosItem(resolved);
    expect(result.quantities).toEqual({});
    expect(result.hasFractional).toBe(true);
  });

  it('excludes blocked lines from the totals', () => {
    const resolved = resolveDeliveryLines(
      [line({ product_id: 'A', base_qty: 5 }), line({ product_id: 'UNKNOWN', base_qty: 9 })],
      { A: { inventoryItemId: 'Beras_1', sdrgBaseUnit: 'kg' } }
    );
    expect(aggregateByPosItem(resolved).quantities).toEqual({ Beras_1: 5 });
  });
});

describe('computeNetDeltas', () => {
  it('applies the full quantity the first time', () => {
    expect(computeNetDeltas({ Gula_1: 5 }, {})).toEqual({ Gula_1: 5 });
  });

  it('applies only the difference on a revised quantity', () => {
    expect(computeNetDeltas({ Gula_1: 8 }, { Gula_1: 5 })).toEqual({ Gula_1: 3 });
  });

  it('reverses an item dropped from the order entirely', () => {
    expect(computeNetDeltas({ Gula_1: 5 }, { Gula_1: 5, Telur_1: 30 })).toEqual({ Telur_1: -30 });
  });

  it('is empty when nothing changed', () => {
    expect(computeNetDeltas({ Gula_1: 5 }, { Gula_1: 5 })).toEqual({});
  });

  it('cancellation against an empty target reverses everything applied', () => {
    expect(computeNetDeltas({}, { Gula_1: 5 })).toEqual({ Gula_1: -5 });
  });
});
