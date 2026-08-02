const toMillis = (value) => {
    if (value?.toMillis) return value.toMillis();
    if (value?.toDate) return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    const parsed = new Date(value || 0).getTime();
    return Number.isFinite(parsed) ? parsed : NaN;
};

const normalized = (value) => String(value || '').trim().toLowerCase();

const legacyPurchaseBaseQty = (item, product) => {
    const explicitBaseQty = Number(item.base_qty);
    if (Number.isFinite(explicitBaseQty) && explicitBaseQty >= 0) return explicitBaseQty;

    const qty = Number(item.qty);
    if (!Number.isFinite(qty) || qty < 0) return NaN;

    const baseUnit = normalized(product?.base_unit || item.base_unit);
    const bulkUnit = normalized(product?.bulk_unit_name || item.bulk_unit_name);
    const unit = normalized(item.unit);
    const conversion = Number(product?.bulk_unit_conversion || item.bulk_unit_conversion || 1);
    const isBulk = Boolean(unit && bulkUnit && unit === bulkUnit && unit !== baseUnit);

    return qty * (isBulk && Number.isFinite(conversion) && conversion > 0 ? conversion : 1);
};

const matchingLegacyPurchase = (movement, purchases, products) => {
    if (movement.transaction_type !== 'stock_adjusted') return null;
    if (Number(movement.change_qty) <= 0) return null;
    if (!String(movement.transaction_id || '').startsWith('ADJ-')) return null;

    const movementTime = toMillis(movement.created_at);
    if (!Number.isFinite(movementTime)) return null;

    return purchases
        .map(purchase => {
            const purchaseTime = toMillis(purchase.created_at);
            const item = (purchase.items || []).find(candidate => candidate.product_id === movement.product_id);
            const product = products.find(candidate => candidate.sku === movement.product_id);
            const baseQty = item ? legacyPurchaseBaseQty(item, product) : NaN;
            const timeDelta = Math.abs(purchaseTime - movementTime);
            return { purchase, baseQty, timeDelta };
        })
        .filter(({ purchase, baseQty, timeDelta }) => (
            purchase.id
            && Number.isFinite(baseQty)
            && Math.abs(baseQty - Number(movement.change_qty)) < 1e-9
            && Number.isFinite(timeDelta)
            && timeDelta <= 30 * 60 * 1000
        ))
        .sort((left, right) => left.timeDelta - right.timeDelta)[0]?.purchase || null;
};

/**
 * Resolve the label type shown in the movement log. New movements already have
 * an explicit type. The legacy fallback only upgrades ADJ+ movements when a
 * matching purchase record proves the stock came from a purchase.
 */
export const resolveMovementDisplayType = (movement, purchases = [], products = []) => {
    const purchase = matchingLegacyPurchase(movement, purchases, products);
    if (!purchase) return movement.transaction_type;
    return purchase.source === 'stock_adjustment' ? 'manual_purchase' : 'purchase_created';
};
