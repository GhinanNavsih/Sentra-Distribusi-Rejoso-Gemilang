export class InventoryValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'InventoryValidationError';
    this.details = details;
  }
}

export const normalizeUnitName = (value) => String(value || '').trim().toLowerCase();

export const finiteNumber = (value, label, { min = 0, allowZero = true } = {}) => {
  const parsed = Number(value);
  const invalidZero = !allowZero && parsed === 0;
  if (!Number.isFinite(parsed) || parsed < min || invalidZero) {
    throw new InventoryValidationError(`${label} harus berupa angka valid${allowZero ? '' : ' lebih dari 0'}.`, {
      field: label,
      value
    });
  }
  return parsed;
};

export const normalizedProductUnits = (product = {}) => {
  const baseUnit = String(product.base_unit || '').trim();
  const bulkUnit = String(product.bulk_unit_name || '').trim();
  const sameUnit = Boolean(baseUnit && bulkUnit && normalizeUnitName(baseUnit) === normalizeUnitName(bulkUnit));
  const rawConversion = sameUnit ? 1 : Number(product.bulk_unit_conversion || 1);

  if (!baseUnit) {
    throw new InventoryValidationError('Satuan dasar produk belum dikonfigurasi.', { product_id: product.sku || product.id });
  }
  if (!Number.isFinite(rawConversion) || rawConversion <= 0) {
    throw new InventoryValidationError('Konversi satuan besar harus lebih dari 0.', {
      product_id: product.sku || product.id,
      conversion: product.bulk_unit_conversion
    });
  }

  return {
    baseUnit,
    bulkUnit,
    sameUnit,
    conversion: rawConversion
  };
};

export const resolveUnitKind = (line = {}, product = {}) => {
  if (line.unit_kind === 'base' || line.unit_kind === 'bulk') return line.unit_kind;
  if (line.selected_unit === 'base' || line.selected_unit === 'bulk') return line.selected_unit;

  const { baseUnit, bulkUnit, sameUnit } = normalizedProductUnits(product);
  const enteredUnit = normalizeUnitName(line.unit);
  if (!enteredUnit || enteredUnit === normalizeUnitName(baseUnit)) return 'base';
  if (!sameUnit && bulkUnit && enteredUnit === normalizeUnitName(bulkUnit)) return 'bulk';

  throw new InventoryValidationError('Satuan transaksi tidak sesuai dengan konfigurasi produk.', {
    product_id: product.sku || product.id,
    unit: line.unit,
    base_unit: baseUnit,
    bulk_unit: bulkUnit
  });
};

export const snapshotLine = (line, product) => {
  const qty = finiteNumber(line.qty, 'Jumlah', { min: 0, allowZero: false });
  const { baseUnit, bulkUnit, sameUnit, conversion } = normalizedProductUnits(product);
  const unitKind = resolveUnitKind(line, product);
  if (unitKind === 'bulk' && (!bulkUnit || sameUnit)) {
    throw new InventoryValidationError('Produk ini tidak memiliki satuan besar yang valid.', {
      product_id: product.sku || product.id
    });
  }

  const multiplier = unitKind === 'bulk' ? conversion : 1;
  const baseQty = qty * multiplier;
  if (!Number.isFinite(baseQty) || baseQty <= 0) {
    throw new InventoryValidationError('Jumlah satuan dasar tidak valid.', {
      product_id: product.sku || product.id,
      qty,
      multiplier
    });
  }

  return {
    qty,
    unit_kind: unitKind,
    unit: unitKind === 'bulk' ? bulkUnit : baseUnit,
    unit_label: unitKind === 'bulk' ? bulkUnit : baseUnit,
    base_qty: baseQty,
    base_unit: baseUnit,
    bulk_unit_name: bulkUnit || null,
    bulk_unit_conversion: conversion
  };
};

export const storedBaseQuantity = (line = {}) => {
  const explicitBaseQty = Number(line.base_qty);
  if (Number.isFinite(explicitBaseQty) && explicitBaseQty >= 0) return explicitBaseQty;

  const qty = finiteNumber(line.qty, 'Jumlah', { min: 0, allowZero: true });
  const unitKind = line.unit_kind || line.selected_unit || 'base';
  if (unitKind !== 'bulk') return qty;

  const baseUnit = normalizeUnitName(line.base_unit);
  const bulkUnit = normalizeUnitName(line.bulk_unit_name);
  const sameUnit = Boolean(baseUnit && bulkUnit && baseUnit === bulkUnit);
  const conversion = sameUnit ? 1 : Number(line.bulk_unit_conversion || 1);
  if (!Number.isFinite(conversion) || conversion <= 0) {
    throw new InventoryValidationError('Metadata konversi transaksi tidak valid.', {
      product_id: line.product_id,
      conversion: line.bulk_unit_conversion
    });
  }
  return qty * conversion;
};

export const editedLineSnapshot = (originalLine, update) => {
  const qty = finiteNumber(update.qty, 'Jumlah', { min: 0, allowZero: false });
  const baseUnit = String(originalLine.base_unit || '').trim();
  const bulkUnit = String(originalLine.bulk_unit_name || '').trim();
  const conversion = Number(originalLine.bulk_unit_conversion || 1);
  if (!baseUnit || !Number.isFinite(conversion) || conversion <= 0) {
    throw new InventoryValidationError('Metadata satuan historis tidak lengkap.', {
      kind: 'legacy-metadata-review',
      product_id: originalLine.product_id
    });
  }

  const unitKind = update.unit_kind || update.selected_unit || (
    normalizeUnitName(update.unit) === normalizeUnitName(bulkUnit) && bulkUnit ? 'bulk' : 'base'
  );
  if (unitKind !== 'base' && unitKind !== 'bulk') {
    throw new InventoryValidationError('Jenis satuan transaksi tidak valid.', { product_id: originalLine.product_id });
  }
  if (unitKind === 'bulk' && !bulkUnit) {
    throw new InventoryValidationError('Satuan besar historis tidak tersedia.', {
      kind: 'legacy-metadata-review',
      product_id: originalLine.product_id
    });
  }

  return {
    qty,
    unit_kind: unitKind,
    unit: unitKind === 'bulk' ? bulkUnit : baseUnit,
    unit_label: unitKind === 'bulk' ? bulkUnit : baseUnit,
    base_qty: qty * (unitKind === 'bulk' ? conversion : 1),
    base_unit: baseUnit,
    bulk_unit_name: bulkUnit || null,
    bulk_unit_conversion: conversion
  };
};
