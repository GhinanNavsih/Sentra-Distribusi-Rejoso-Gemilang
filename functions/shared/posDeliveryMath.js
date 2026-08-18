const normalizeUnit = (value) => String(value || '').toLowerCase().trim();

// Mirrors the POS app's own SdrgProductLinkService.resolveLines: a line is
// blocked when no link exists yet, or when the product's unit has drifted
// since the link was made. Both cases need a person to look and confirm --
// applying either automatically risks moving stock by the wrong amount.
export const resolveDeliveryLines = (lines, links) => {
  return lines.map(line => {
    const link = links[line.product_id];
    if (!link || !link.inventoryItemId) {
      return { ...line, posItemId: null, blocked: 'unmapped' };
    }
    if (normalizeUnit(link.sdrgBaseUnit) !== normalizeUnit(line.base_unit)) {
      return { ...line, posItemId: link.inventoryItemId, blocked: 'unit_drift' };
    }
    return { ...line, posItemId: link.inventoryItemId, blocked: null };
  });
};

// Mirrors SdrgProductLinkService.quantitiesByInventoryItem: totals are summed
// per POS inventory item *before* checking wholeness, so two SDRG products
// that map to the same POS item can still combine into a clean integer even
// if neither line is whole on its own.
export const aggregateByPosItem = (resolvedLines) => {
  const totals = {};
  for (const line of resolvedLines) {
    if (line.blocked) continue;
    totals[line.posItemId] = (totals[line.posItemId] || 0) + Number(line.base_qty || 0);
  }

  const quantities = {};
  let hasFractional = false;
  for (const [id, total] of Object.entries(totals)) {
    const rounded = Math.round(total);
    if (Math.abs(total - rounded) > 1e-6) {
      hasFractional = true;
    } else {
      quantities[id] = rounded;
    }
  }
  return { quantities, hasFractional };
};

// Net change per POS inventory item needed to bring what's already applied in
// line with what this delivery now says. A cancelled delivery targets zero,
// which is why cancellation needs no separate branch.
export const computeNetDeltas = (targetQuantities, appliedQuantities) => {
  const deltas = {};
  for (const id of new Set([...Object.keys(targetQuantities), ...Object.keys(appliedQuantities)])) {
    const change = (targetQuantities[id] || 0) - (appliedQuantities[id] || 0);
    if (change !== 0) deltas[id] = change;
  }
  return deltas;
};
