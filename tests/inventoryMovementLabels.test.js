import { describe, expect, it } from 'vitest';
import { resolveMovementDisplayType } from '../src/utils/inventoryMovementLabels.js';

const product = {
    sku: 'A',
    base_unit: 'pcs',
    bulk_unit_name: 'Box',
    bulk_unit_conversion: 10
};

const movement = {
    transaction_type: 'stock_adjusted',
    transaction_id: 'ADJ-2026-07-27-1785124421822-A',
    product_id: 'A',
    change_qty: 20,
    created_at: new Date('2026-07-28T04:43:00.000Z')
};

describe('legacy inventory movement labels', () => {
    it('renders a legacy bulk purchase as a purchase', () => {
        expect(resolveMovementDisplayType(movement, [{
            id: 'PUR-2026-07-28-0002',
            created_at: new Date('2026-07-28T04:43:02.000Z'),
            items: [{ product_id: 'A', qty: 2, unit: 'Box' }]
        }], [product])).toBe('purchase_created');
    });

    it('keeps a legacy stock-adjustment purchase distinct from a bulk purchase', () => {
        expect(resolveMovementDisplayType(movement, [{
            id: 'PUR-2026-07-28-0002',
            source: 'stock_adjustment',
            created_at: new Date('2026-07-28T04:43:02.000Z'),
            items: [{ product_id: 'A', qty: 20, unit: 'pcs' }]
        }], [product])).toBe('manual_purchase');
    });

    it('does not relabel an unmatched manual adjustment', () => {
        expect(resolveMovementDisplayType(movement, [], [product])).toBe('stock_adjusted');
    });
});
