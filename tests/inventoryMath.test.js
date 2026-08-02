import { describe, expect, it } from 'vitest';
import {
  InventoryValidationError,
  editedLineSnapshot,
  normalizedProductUnits,
  snapshotLine,
  storedBaseQuantity
} from '../functions/shared/inventoryMath.js';

const product = {
  sku: 'SUGAR',
  base_unit: 'kg',
  bulk_unit_name: 'Sack',
  bulk_unit_conversion: 50
};

describe('inventory quantity normalization', () => {
  it('converts base and bulk quantities to immutable base quantities', () => {
    expect(snapshotLine({ qty: 2, unit_kind: 'base' }, product).base_qty).toBe(2);
    expect(snapshotLine({ qty: 2, unit_kind: 'bulk' }, product).base_qty).toBe(100);
  });

  it('treats equivalent unit names as a one-to-one base unit', () => {
    const units = normalizedProductUnits({
      sku: 'PCS',
      base_unit: ' pcs ',
      bulk_unit_name: 'Pcs',
      bulk_unit_conversion: 12
    });
    expect(units.sameUnit).toBe(true);
    expect(units.conversion).toBe(1);
  });

  it('rejects invalid quantities and conversions', () => {
    expect(() => snapshotLine({ qty: 0, unit_kind: 'base' }, product)).toThrow(InventoryValidationError);
    expect(() => snapshotLine({ qty: Number.NaN, unit_kind: 'base' }, product)).toThrow(InventoryValidationError);
    expect(() => normalizedProductUnits({ ...product, bulk_unit_conversion: -2 })).toThrow(InventoryValidationError);
  });

  it('uses the transaction conversion snapshot when editing', () => {
    const original = snapshotLine({ qty: 1, unit_kind: 'bulk' }, product);
    const edited = editedLineSnapshot({ product_id: 'SUGAR', ...original }, { qty: 3, unit_kind: 'bulk' });
    expect(edited.base_qty).toBe(150);
    expect(storedBaseQuantity(edited)).toBe(150);
  });
});
