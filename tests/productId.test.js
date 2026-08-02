import { describe, expect, it } from 'vitest';
import {
  createProductId,
  createUniqueProductId,
  productIdPrefix,
  PRODUCT_ID_PATTERN
} from '../functions/shared/productId.js';
import {
  buildHistoricalReconciliation,
  buildProductMapping,
  buildMappingFromPlan,
  documentPathKey,
  findUnresolvedReferences,
  reconciliationFromPlan,
  resolveInventoryProductId,
  rewriteHistoricalReferences,
  rewriteProductReferences
} from '../scripts/productIdMigration.js';

describe('automatic product IDs', () => {
  it('creates the requested initials and ignores attached-number words', () => {
    expect(productIdPrefix('Beras Serang Dua Putri (25kg)')).toBe('BSDP');
    expect(createProductId('Beras Serang Dua Putri (25kg)', () => '4X9U')).toBe('BSDP_4X9U');
  });

  it('ignores symbols and number-containing words', () => {
    expect(productIdPrefix('Minyak, Goreng Sunia (1lt) 2in1')).toBe('MGS');
    expect(productIdPrefix('(500ml)')).toBe('ITEM');
  });

  it('uses an uppercase four-character suffix', () => {
    const id = createProductId('Gula Pasir', () => 'a9z0'.toUpperCase());
    expect(id).toMatch(PRODUCT_ID_PATTERN);
  });

  it('retries when the generated ID is already taken', async () => {
    const suffixes = ['AAAA', 'BBBB'];
    const id = await createUniqueProductId(
      'Garam Cap Kapal',
      candidate => candidate === 'GCK_AAAA',
      { suffixFactory: () => suffixes.shift() }
    );
    expect(id).toBe('GCK_BBBB');
  });
});

describe('product ID migration helpers', () => {
  it('maps both legacy document IDs and SKU aliases', () => {
    const result = buildProductMapping([
      { id: 'old-1', data: { sku: 'SKU-1', name: 'Beras Serang' } }
    ], { reservedIds: new Set(['old-1', 'SKU-1']), suffixFactory: () => 'AB12' });

    expect(result.errors).toEqual([]);
    expect(result.mapping.get('old-1')).toBe('BS_AB12');
    expect(result.mapping.get('SKU-1')).toBe('BS_AB12');
  });

  it('rewrites historical product references but preserves legacy metadata', () => {
    const mapping = new Map([['OLD', 'NEW_AB12']]);
    const value = {
      items: [{ product_id: 'OLD', sku: 'OLD' }],
      legacy_sku: 'OLD'
    };
    expect(rewriteProductReferences(value, mapping)).toEqual({
      items: [{ product_id: 'NEW_AB12', sku: 'NEW_AB12' }],
      legacy_sku: 'OLD'
    });
    expect(findUnresolvedReferences(value, mapping)).toEqual([]);
  });

  it('rejects an inventory record whose document and stored IDs disagree', () => {
    const mapping = new Map([['OLD-A', 'NEW_A'], ['OLD-B', 'NEW_B']]);
    expect(resolveInventoryProductId({ id: 'OLD-A', data: { product_id: 'OLD-B' } }, mapping).error.kind)
      .toBe('ambiguous-inventory-reference');
  });

  it('reconciles reused legacy IDs per historical product name and archives missing products', () => {
    const suffixes = ['AAAA', 'BBBB', 'CCCC'];
    const products = [
      { id: 'OLD-BERAS', data: { sku: 'OLD-BERAS', name: 'Beras Serang (10kg)', base_unit: 'kg' } },
      { id: 'OLD-BSDP', data: { sku: 'OLD-BSDP', name: 'Beras Serang Dua Putri (10kg)', base_unit: 'kg' } }
    ];
    const mappingResult = buildProductMapping(products, {
      reservedIds: new Set(products.map(product => product.id)),
      suffixFactory: () => suffixes.shift()
    });
    const historicalDocuments = [{
      collection: 'orders',
      id: 'ORDER-1',
      data: {
        items: [
          { product_id: 'LEGACY-BERAS', sku: 'LEGACY-BERAS', product_name: 'Beras Serang (10kg)' },
          { product_id: 'LEGACY-BERAS', sku: 'LEGACY-BERAS', product_name: 'Beras Serang Dua Putri (10kg)' },
          { product_id: '101', sku: '101', product_name: 'TestingItem', base_unit: 'pcs' }
        ]
      }
    }];

    const reconciliation = buildHistoricalReconciliation({
      historicalDocuments,
      products,
      mapping: mappingResult.mapping,
      reservedIds: new Set(products.map(product => product.id)),
      suffixFactory: () => suffixes.shift()
    });

    expect(reconciliation.errors).toEqual([]);
    expect(reconciliation.archivedProducts).toHaveLength(1);
    expect(reconciliation.resolutions).toEqual(expect.arrayContaining([
      expect.objectContaining({ old_id: 'LEGACY-BERAS', source: 'current-product-name' }),
      expect.objectContaining({ old_id: '101', source: 'archived-product' })
    ]));

    const documentPath = documentPathKey('orders', 'ORDER-1');
    const rewritten = rewriteHistoricalReferences(
      historicalDocuments[0].data,
      mappingResult.mapping,
      reconciliation.resolutionsByDocument.get(documentPath)
    );
    expect(rewritten.items[0].product_id).toBe(mappingResult.mapping.get('OLD-BERAS'));
    expect(rewritten.items[1].product_id).toBe(mappingResult.mapping.get('OLD-BSDP'));
    expect(rewritten.items[2].product_id).toBe(reconciliation.archivedProducts[0].id);
    expect(findUnresolvedReferences(rewritten, reconciliation.mapping || mappingResult.mapping)).toEqual([]);
  });

  it('reuses the exact reviewed mapping and reconciliation plan during apply', () => {
    const products = [{ id: 'OLD', data: { sku: 'OLD', name: 'Old Product' } }];
    const plannedEntries = [{ old_id: 'OLD', new_id: 'OP_AB12', name: 'Old Product', aliases: ['OLD'] }];
    const archivedProducts = [{
      id: 'LEG_CDEF',
      legacy_id: 'MISSING',
      name: 'Missing Product',
      data: { name: 'Missing Product', sku: 'LEG_CDEF', active: false }
    }];
    const mappingResult = buildMappingFromPlan(products, plannedEntries, archivedProducts);
    const reconciliation = reconciliationFromPlan({
      archived_products: archivedProducts,
      reconciliations: [{
        document_path: 'orders/O-1',
        path: 'items[0].product_id',
        old_id: 'MISSING',
        new_id: 'LEG_CDEF'
      }]
    });

    expect(mappingResult.errors).toEqual([]);
    expect(mappingResult.mapping.get('OLD')).toBe('OP_AB12');
    expect(mappingResult.mapping.get('LEG_CDEF')).toBe('LEG_CDEF');
    expect(reconciliation.resolutionsByDocument.get('orders/O-1').get('items[0].product_id'))
      .toBe('LEG_CDEF');
  });
});
