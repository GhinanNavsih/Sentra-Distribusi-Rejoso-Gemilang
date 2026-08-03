import { createHash } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger, setGlobalOptions } from 'firebase-functions/v2';
import {
  InventoryValidationError,
  editedLineSnapshot,
  finiteNumber,
  normalizeUnitName,
  normalizedProductUnits,
  snapshotLine,
  storedBaseQuantity
} from './shared/inventoryMath.js';
import { createProductId } from './shared/productId.js';

initializeApp();
const db = getFirestore();

setGlobalOptions({ region: 'asia-southeast2', maxInstances: 20 });

const MAX_LINES = 80;

const collectionName = (baseName, environment) => {
  if (environment !== 'production' && environment !== 'staging') {
    throw new HttpsError('invalid-argument', 'Environment inventori tidak valid.');
  }
  return environment === 'staging' ? `${baseName}_test` : baseName;
};

const collectionsFor = (environment) => ({
  inventory: collectionName('inventory', environment),
  movements: collectionName('stock_movements', environment),
  operations: collectionName('inventory_operations', environment),
  orders: collectionName('orders', environment),
  purchases: collectionName('purchases', environment),
  counters: collectionName('counters', environment),
  losses: collectionName('stock_losses', environment),
  products: collectionName('products', environment)
});

const assertOperationId = (value) => {
  const operationId = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(operationId)) {
    throw new HttpsError('invalid-argument', 'Operation ID tidak valid.');
  }
  return operationId;
};

const assertProductId = (value) => {
  const productId = String(value || '').trim();
  if (!productId || productId.length > 180 || productId.includes('/')) {
    throw new InventoryValidationError('SKU produk tidak valid.', { product_id: value });
  }
  return productId;
};

const assertItems = (items) => {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_LINES) {
    throw new HttpsError('invalid-argument', `Transaksi harus memiliki 1-${MAX_LINES} item.`);
  }
  return items;
};

const localDateString = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const allocateDailyId = async (transaction, collection, counterSnapshot, prefix) => {
  const storedCount = counterSnapshot?.exists ? Number(counterSnapshot.data().count || 0) : 0;
  let nextCount = Number.isSafeInteger(storedCount) && storedCount >= 0 ? storedCount + 1 : 1;

  for (let attempt = 0; attempt < 1000; attempt += 1, nextCount += 1) {
    const id = `${prefix}${String(nextCount).padStart(4, '0')}`;
    const ref = collection.doc(id);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return { id, nextCount, ref };
  }

  throw new HttpsError('resource-exhausted', 'Tidak dapat mengalokasikan nomor transaksi. Counter perlu direkonsiliasi.');
};

const movementId = (operationId, productId, type) => createHash('sha256')
  .update(`${operationId}:${productId}:${type}`)
  .digest('hex');

const getOperator = async (request, allowedRoles = null) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Silakan masuk kembali.');

  const userDoc = await db.collection('users').doc(request.auth.uid).get();
  const role = userDoc.exists ? (userDoc.data().role || 'shopper') : 'shopper';
  if (allowedRoles && !allowedRoles.includes(role)) {
    throw new HttpsError('permission-denied', 'Anda tidak memiliki izin untuk tindakan ini.');
  }

  return {
    uid: request.auth.uid,
    email: request.auth.token.email || request.auth.uid,
    role
  };
};

// Cloud Run must accept the browser's unauthenticated OPTIONS preflight before
// Firebase callable authentication can be checked inside the handler. The
// current firebase-functions onCall manifest does not emit the Cloud Run IAM
// invoker binding, so that binding is provisioned separately during deployment.
const callable = (handler, allowedRoles = null) => onCall({ cors: true }, async (request) => {
  const operator = await getOperator(request, allowedRoles);
  try {
    return await handler(request.data || {}, operator);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof InventoryValidationError) {
      throw new HttpsError('invalid-argument', error.message, error.details || undefined);
    }
    logger.error('Inventory operation failed', error);
    throw new HttpsError('internal', error?.message || 'Operasi inventori gagal.');
  }
});

const currentStock = (snapshot) => {
  if (!snapshot.exists) return 0;
  const stock = Number(snapshot.data().current_stock_base);
  if (!Number.isFinite(stock)) {
    throw new HttpsError('failed-precondition', 'Nilai stok tersimpan tidak valid.', {
      kind: 'invalid-current-stock',
      product_id: snapshot.id
    });
  }
  return stock;
};

const writeMovement = (transaction, names, operationId, movement) => {
  const ref = db.collection(names.movements).doc(movementId(operationId, movement.product_id, movement.transaction_type));
  transaction.set(ref, {
    id: ref.id,
    operation_id: operationId,
    product_id: movement.product_id,
    product_name: movement.product_name || movement.product_id,
    transaction_id: movement.transaction_id,
    transaction_type: movement.transaction_type,
    change_qty: movement.change_qty,
    stock_before: movement.stock_before,
    stock_after: movement.stock_after,
    operator: movement.operator.email,
    operator_uid: movement.operator.uid,
    reason: movement.reason || null,
    revision: movement.revision || 1,
    created_at: FieldValue.serverTimestamp()
  });
};

const writeOperation = (transaction, operationRef, operationId, kind, operator, result) => {
  transaction.set(operationRef, {
    id: operationId,
    kind,
    operator_uid: operator.uid,
    operator: operator.email,
    result,
    created_at: FieldValue.serverTimestamp()
  });
};

const existingOperationResult = (snapshot) => snapshot.exists ? snapshot.data().result : null;

const PRODUCT_FIELDS = [
  'name',
  'base_unit',
  'bulk_unit_name',
  'bulk_unit_conversion',
  'cost_price',
  'price_regular',
  'price_premium',
  'price_star',
  'image_url',
  'category',
  'needs_stock_check'
];

const productFields = (rawProduct = {}, { partial = false } = {}) => {
  if (rawProduct.sku !== undefined && String(rawProduct.sku || '').trim()) {
    throw new InventoryValidationError('ID produk dibuat otomatis dan tidak boleh dikirim manual.', {
      field: 'sku'
    });
  }

  const result = {};
  PRODUCT_FIELDS.forEach(field => {
    if (rawProduct[field] === undefined && partial) return;
    if (rawProduct[field] === undefined) return;

    if (['name', 'base_unit', 'bulk_unit_name', 'image_url', 'category'].includes(field)) {
      result[field] = rawProduct[field] === null ? '' : String(rawProduct[field]).trim();
      return;
    }
    if (field === 'needs_stock_check') {
      result[field] = Boolean(rawProduct[field]);
      return;
    }

    const value = Number(rawProduct[field]);
    if (!Number.isFinite(value) || value < 0) {
      throw new InventoryValidationError(`${field} harus berupa angka valid.`, { field, value: rawProduct[field] });
    }
    result[field] = value;
  });

  if (!partial && !result.name) {
    throw new InventoryValidationError('Nama produk wajib diisi.', { field: 'name' });
  }
  if (!partial && !result.base_unit) {
    throw new InventoryValidationError('Satuan dasar produk wajib diisi.', { field: 'base_unit' });
  }
  if (result.bulk_unit_conversion !== undefined && result.bulk_unit_conversion <= 0) {
    throw new InventoryValidationError('Konversi satuan besar harus lebih dari 0.', {
      field: 'bulk_unit_conversion'
    });
  }

  return result;
};

const productMapFromSnapshots = (snapshots, { allowArchived = false } = {}) => new Map(snapshots.map(snapshot => {
  if (!snapshot.exists || (!allowArchived && snapshot.data().active === false)) {
    throw new InventoryValidationError('Produk tidak ditemukan atau sudah diarsipkan.', { product_id: snapshot.id });
  }
  return [snapshot.id, { id: snapshot.id, ...snapshot.data() }];
}));

const rejectDuplicateItems = (items) => {
  const seen = new Set();
  for (const item of items) {
    const productId = assertProductId(item.product_id);
    if (seen.has(productId)) {
      throw new InventoryValidationError('Produk yang sama tidak boleh muncul lebih dari sekali.', {
        product_id: productId
      });
    }
    seen.add(productId);
  }
};

const hasDuplicateProducts = (items) => {
  const ids = items.map(item => assertProductId(item.product_id));
  return new Set(ids).size !== ids.length;
};

const aggregateHistoricalLines = (items, quantityForLine) => {
  const aggregated = new Map();
  items.forEach(item => {
    const productId = assertProductId(item.product_id);
    const quantity = quantityForLine(item);
    const existing = aggregated.get(productId);
    if (existing) {
      existing.base_qty += quantity;
    } else {
      aggregated.set(productId, {
        product_id: productId,
        product_name: item.product_name || productId,
        base_unit: item.base_unit,
        base_qty: quantity
      });
    }
  });
  return [...aggregated.values()];
};

const collapsePurchaseLines = (lines) => {
  const collapsed = new Map();
  lines.forEach(line => {
    const existing = collapsed.get(line.product_id);
    if (!existing) {
      collapsed.set(line.product_id, line);
      return;
    }

    const baseQty = existing.base_qty + line.base_qty;
    const total = existing.total + line.total;
    collapsed.set(line.product_id, {
      ...existing,
      qty: baseQty,
      unit_kind: 'base',
      unit: existing.base_unit,
      unit_label: existing.base_unit,
      base_qty: baseQty,
      cost_per_unit: baseQty > 0 ? total / baseQty : 0,
      total
    });
  });
  return [...collapsed.values()];
};

const legacyPurchaseBaseQuantity = (line, product) => {
  const explicit = Number(line.base_qty);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;

  const qty = finiteNumber(line.qty, 'Jumlah', { min: 0, allowZero: true });
  const { baseUnit, bulkUnit, sameUnit } = normalizedProductUnits(product);
  const unit = normalizeUnitName(line.unit);
  if (!unit || sameUnit || unit === normalizeUnitName(baseUnit)) return qty;
  if (bulkUnit && unit === normalizeUnitName(bulkUnit)) {
    throw new HttpsError('failed-precondition', 'Pembelian lama ini belum memiliki snapshot konversi yang aman.', {
      kind: 'legacy-metadata-review',
      product_id: line.product_id,
      transaction_id: line.transaction_id || null
    });
  }
  throw new HttpsError('failed-precondition', 'Satuan pembelian lama tidak dapat diverifikasi.', {
    kind: 'legacy-metadata-review',
    product_id: line.product_id
  });
};

const hydrateHistoricalLine = (line, product, transactionType) => {
  if (line.base_unit && Number.isFinite(Number(line.bulk_unit_conversion || 1))) return line;

  if (transactionType === 'purchase') {
    const baseQty = legacyPurchaseBaseQuantity(line, product);
    const { baseUnit, bulkUnit, conversion } = normalizedProductUnits(product);
    return {
      ...line,
      qty: baseQty,
      unit_kind: 'base',
      unit: baseUnit,
      unit_label: baseUnit,
      base_qty: baseQty,
      base_unit: baseUnit,
      bulk_unit_name: bulkUnit || null,
      bulk_unit_conversion: conversion
    };
  }

  const unitSnapshot = snapshotLine({ qty: line.qty, unit_kind: line.selected_unit || 'base' }, product);
  return { ...line, ...unitSnapshot };
};

const makeInsufficientError = (details, message = 'Stok tidak mencukupi.') => new HttpsError(
  'failed-precondition',
  message,
  { kind: 'insufficient-stock', items: details }
);

export const createProduct = callable(async (data, operator) => {
  const names = collectionsFor(data.environment);
  const operationId = assertOperationId(data.operation_id);
  const fields = productFields(data.product || {});

  return db.runTransaction(async transaction => {
    const operationRef = db.collection(names.operations).doc(`product_create_${operationId}`);
    const operationSnapshot = await transaction.get(operationRef);
    const existing = existingOperationResult(operationSnapshot);
    if (existing) return existing;

    const productsCollection = db.collection(names.products);
    let productId = null;
    let productRef = null;
    let productSnapshot = null;

    for (let attempt = 0; attempt < 10000; attempt += 1) {
      const candidate = createProductId(fields.name);
      const candidateRef = productsCollection.doc(candidate);
      const candidateSnapshot = await transaction.get(candidateRef);
      if (!candidateSnapshot.exists) {
        productId = candidate;
        productRef = candidateRef;
        productSnapshot = candidateSnapshot;
        break;
      }
    }

    if (!productId || productSnapshot?.exists) {
      throw new HttpsError('resource-exhausted', 'Tidak dapat menghasilkan ID produk unik. Silakan coba lagi.');
    }

    transaction.create(productRef, {
      ...fields,
      sku: productId,
      active: true,
      created_by: operator.email,
      created_by_uid: operator.uid,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp()
    });

    const result = { product_id: productId, sku: productId };
    writeOperation(transaction, operationRef, operationId, 'create_product', operator, result);
    return result;
  });
});

export const updateProduct = callable(async (data, operator) => {
  const names = collectionsFor(data.environment);
  const operationId = assertOperationId(data.operation_id);
  const productId = assertProductId(data.product_id);
  const fields = productFields(data.product || {}, { partial: true });

  return db.runTransaction(async transaction => {
    const operationRef = db.collection(names.operations).doc(`product_update_${operationId}`);
    const operationSnapshot = await transaction.get(operationRef);
    const existing = existingOperationResult(operationSnapshot);
    if (existing) return existing;

    const productRef = db.collection(names.products).doc(productId);
    const productSnapshot = await transaction.get(productRef);
    if (!productSnapshot.exists) throw new HttpsError('not-found', 'Produk tidak ditemukan.');

    transaction.update(productRef, {
      ...fields,
      sku: productId,
      updated_at: FieldValue.serverTimestamp(),
      updated_by: operator.email,
      updated_by_uid: operator.uid
    });

    const result = { product_id: productId, sku: productId };
    writeOperation(transaction, operationRef, operationId, 'update_product', operator, result);
    return result;
  });
});

export const archiveProduct = callable(async (data, operator) => {
  const names = collectionsFor(data.environment);
  const operationId = assertOperationId(data.operation_id);
  const productId = assertProductId(data.product_id);

  return db.runTransaction(async transaction => {
    const operationRef = db.collection(names.operations).doc(`product_archive_${operationId}`);
    const operationSnapshot = await transaction.get(operationRef);
    const existing = existingOperationResult(operationSnapshot);
    if (existing) return existing;

    const productRef = db.collection(names.products).doc(productId);
    const productSnapshot = await transaction.get(productRef);
    if (!productSnapshot.exists) throw new HttpsError('not-found', 'Produk tidak ditemukan.');

    transaction.update(productRef, {
      active: false,
      archived_at: FieldValue.serverTimestamp(),
      archived_by: operator.email,
      archived_by_uid: operator.uid,
      updated_at: FieldValue.serverTimestamp()
    });

    const result = { product_id: productId, sku: productId, archived: true };
    writeOperation(transaction, operationRef, operationId, 'archive_product', operator, result);
    return result;
  });
});

export const receivePurchase = callable(async (data, operator) => {
  const names = collectionsFor(data.environment);
  const operationId = assertOperationId(data.operation_id);
  const rawItems = assertItems(data.items);
  const productIds = [...new Set(rawItems.map(item => assertProductId(item.product_id)))];

  return db.runTransaction(async transaction => {
    const operationRef = db.collection(names.operations).doc(operationId);
    const operationSnapshot = await transaction.get(operationRef);
    const existing = existingOperationResult(operationSnapshot);
    if (existing) return existing;

    const date = localDateString();
    const counterRef = db.collection(names.counters).doc(`purchases_${date}`);
    const purchasePrefix = `PUR-${date}-`;
    const productRefs = productIds.map(id => db.collection(names.products).doc(id));
    const inventoryRefs = productIds.map(id => db.collection(names.inventory).doc(id));
    const [counterSnapshot, productSnapshots, inventorySnapshots] = await Promise.all([
      transaction.get(counterRef),
      Promise.all(productRefs.map(ref => transaction.get(ref))),
      Promise.all(inventoryRefs.map(ref => transaction.get(ref)))
    ]);

    const products = productMapFromSnapshots(productSnapshots);
    const lines = collapsePurchaseLines(rawItems.map(item => {
      const product = products.get(item.product_id);
      const units = snapshotLine(item, product);
      const costPerUnit = finiteNumber(item.cost_per_unit ?? item.unit_price, 'Harga beli', { min: 0, allowZero: true });
      return {
        product_id: item.product_id,
        product_name: product.name || item.product_name || item.product_id,
        ...units,
        cost_per_unit: costPerUnit,
        total: Math.ceil(costPerUnit * units.qty)
      };
    }));

    const purchaseSequence = await allocateDailyId(
      transaction,
      db.collection(names.purchases),
      counterSnapshot,
      purchasePrefix
    );
    const { id: purchaseId, nextCount, ref: purchaseRef } = purchaseSequence;

    lines.forEach((line, index) => {
      const before = currentStock(inventorySnapshots[index]);
      const after = before + line.base_qty;
      transaction.set(inventoryRefs[index], {
        product_id: line.product_id,
        current_stock_base: after,
        updated_at: FieldValue.serverTimestamp()
      }, { merge: true });

      const baseCost = Math.ceil(line.total / line.base_qty);
      transaction.set(productRefs[index], {
        cost_price: baseCost,
        price_star: baseCost,
        updated_at: FieldValue.serverTimestamp()
      }, { merge: true });

      writeMovement(transaction, names, operationId, {
        product_id: line.product_id,
        product_name: line.product_name,
        transaction_id: purchaseId,
        transaction_type: 'purchase_created',
        change_qty: line.base_qty,
        stock_before: before,
        stock_after: after,
        operator
      });
    });

    const grandTotal = lines.reduce((sum, line) => sum + line.total, 0);
    transaction.set(counterRef, { count: nextCount, updated_at: FieldValue.serverTimestamp() }, { merge: true });
    transaction.set(purchaseRef, {
      id: purchaseId,
      items: lines,
      grand_total: grandTotal,
      supplier_name: String(data.supplier_name || 'N/A').trim() || 'N/A',
      receipt_file: data.receipt_file || null,
      source: data.source || 'bulk_purchase',
      status: 'completed',
      revision: 1,
      operation_id: operationId,
      created_by: operator.email,
      created_by_uid: operator.uid,
      created_at: FieldValue.serverTimestamp()
    });

    const result = { purchase_id: purchaseId };
    writeOperation(transaction, operationRef, operationId, 'receive_purchase', operator, result);
    return result;
  });
});

export const createSale = callable(async (data, operator) => {
  const names = collectionsFor(data.environment);
  const operationId = assertOperationId(data.operation_id);
  const orderData = data.order || {};
  const rawItems = assertItems(orderData.items);
  rejectDuplicateItems(rawItems);
  const productIds = rawItems.map(item => assertProductId(item.product_id));
  const paymentStatus = orderData.payment_status === 'unpaid' ? 'unpaid' : 'paid';

  if (paymentStatus === 'unpaid') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(orderData.target_date || '') || orderData.target_date < localDateString()) {
      throw new HttpsError('invalid-argument', 'Tanggal target pre-order harus hari ini atau setelahnya.');
    }
    if (!String(orderData.customer_name || '').trim()) {
      throw new HttpsError('invalid-argument', 'Nama pelanggan / catatan wajib diisi untuk pre-order.');
    }
  }

  return db.runTransaction(async transaction => {
    const operationRef = db.collection(names.operations).doc(operationId);
    const operationSnapshot = await transaction.get(operationRef);
    const existing = existingOperationResult(operationSnapshot);
    if (existing) return existing;

    const date = localDateString();
    const counterRef = db.collection(names.counters).doc(`orders_${date}`);
    const orderPrefix = `${date}-`;
    const productRefs = productIds.map(id => db.collection(names.products).doc(id));
    const inventoryRefs = productIds.map(id => db.collection(names.inventory).doc(id));
    const [counterSnapshot, productSnapshots, inventorySnapshots] = await Promise.all([
      transaction.get(counterRef),
      Promise.all(productRefs.map(ref => transaction.get(ref))),
      paymentStatus === 'paid'
        ? Promise.all(inventoryRefs.map(ref => transaction.get(ref)))
        : Promise.resolve([])
    ]);

    const products = productMapFromSnapshots(productSnapshots);
    const lines = rawItems.map(item => {
      const product = products.get(item.product_id);
      const units = snapshotLine(item, product);
      const unitPrice = finiteNumber(item.unit_price, 'Harga jual', { min: 0, allowZero: true });
      const minimumPrice = Number(product.price_star || 0) * (units.unit_kind === 'bulk' ? units.bulk_unit_conversion : 1);
      if (unitPrice < minimumPrice) {
        throw new InventoryValidationError('Harga jual tidak boleh lebih rendah dari Harga Bintang.', {
          product_id: item.product_id,
          minimum_price: minimumPrice,
          unit_price: unitPrice
        });
      }
      return {
        product_id: item.product_id,
        product_name: product.name || item.product_name || item.product_id,
        sku: item.product_id,
        ...units,
        selected_unit: units.unit_kind,
        unit_price: unitPrice,
        buy_price: Number(product.cost_price || 0) * (units.unit_kind === 'bulk' ? units.bulk_unit_conversion : 1),
        total: Math.ceil(unitPrice * units.qty)
      };
    });

    const insufficient = [];
    if (paymentStatus === 'paid') {
      lines.forEach((line, index) => {
        const available = currentStock(inventorySnapshots[index]);
        if (available < line.base_qty) {
          insufficient.push({
            product_id: line.product_id,
            product_name: line.product_name,
            qty: line.qty,
            selected_unit: line.unit_kind,
            base_unit: line.base_unit,
            bulk_unit_name: line.bulk_unit_name,
            demanded_base: line.base_qty,
            available_base: available,
            delta_base: line.base_qty - available
          });
        }
      });
    }
    if (insufficient.length) throw makeInsufficientError(insufficient);

    const orderSequence = await allocateDailyId(
      transaction,
      db.collection(names.orders),
      counterSnapshot,
      orderPrefix
    );
    const { id: orderId, nextCount, ref: orderRef } = orderSequence;

    if (paymentStatus === 'paid') {
      lines.forEach((line, index) => {
        const before = currentStock(inventorySnapshots[index]);
        const after = before - line.base_qty;
        transaction.update(inventoryRefs[index], {
          current_stock_base: after,
          updated_at: FieldValue.serverTimestamp()
        });
        writeMovement(transaction, names, operationId, {
          product_id: line.product_id,
          product_name: line.product_name,
          transaction_id: orderId,
          transaction_type: 'sale_created',
          change_qty: -line.base_qty,
          stock_before: before,
          stock_after: after,
          operator
        });
      });
    }

    transaction.set(counterRef, { count: nextCount, updated_at: FieldValue.serverTimestamp() }, { merge: true });
    transaction.set(orderRef, {
      id: orderId,
      items: lines,
      grand_total: lines.reduce((sum, line) => sum + line.total, 0),
      customer_name: String(orderData.customer_name || '').trim(),
      customer_type: orderData.customer_type || 'regular',
      target_date: paymentStatus === 'unpaid' ? orderData.target_date : null,
      payment_status: paymentStatus,
      status: paymentStatus === 'unpaid' ? 'unpaid' : 'completed',
      revision: 1,
      operation_id: operationId,
      created_by: operator.email,
      created_by_uid: operator.uid,
      created_at: FieldValue.serverTimestamp()
    });

    const result = { order_id: orderId };
    writeOperation(transaction, operationRef, operationId, 'create_sale', operator, result);
    return result;
  });
});

export const payPreorder = callable(async (data, operator) => {
  const names = collectionsFor(data.environment);
  const operationId = assertOperationId(data.operation_id);
  const orderId = String(data.order_id || '').trim();
  if (!orderId) throw new HttpsError('invalid-argument', 'ID pre-order diperlukan.');

  return db.runTransaction(async transaction => {
    const operationRef = db.collection(names.operations).doc(operationId);
    const orderRef = db.collection(names.orders).doc(orderId);
    const [operationSnapshot, orderSnapshot] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(orderRef)
    ]);
    const existing = existingOperationResult(operationSnapshot);
    if (existing) return existing;
    if (!orderSnapshot.exists) throw new HttpsError('not-found', 'Pre-order tidak ditemukan.');

    const order = orderSnapshot.data();
    if (order.status === 'cancelled') throw new HttpsError('failed-precondition', 'Pre-order sudah dibatalkan.');
    if (order.payment_status !== 'unpaid' && order.status !== 'unpaid') {
      throw new HttpsError('failed-precondition', 'Transaksi ini sudah lunas.');
    }

    const lines = order.items || [];
    const aggregatedLines = aggregateHistoricalLines(lines, storedBaseQuantity);
    const inventoryRefs = aggregatedLines.map(line => db.collection(names.inventory).doc(line.product_id));
    const inventorySnapshots = await Promise.all(inventoryRefs.map(ref => transaction.get(ref)));
    const insufficient = [];

    aggregatedLines.forEach((line, index) => {
      const available = currentStock(inventorySnapshots[index]);
      if (available < line.base_qty) {
        insufficient.push({
          product_id: line.product_id,
          product_name: line.product_name,
          base_unit: line.base_unit,
          demanded_base: line.base_qty,
          available_base: available,
          delta_base: line.base_qty - available
        });
      }
    });
    if (insufficient.length) throw makeInsufficientError(insufficient, 'Stok tidak mencukupi untuk melunasi pre-order.');

    aggregatedLines.forEach((line, index) => {
      const before = currentStock(inventorySnapshots[index]);
      const after = before - line.base_qty;
      transaction.update(inventoryRefs[index], {
        current_stock_base: after,
        updated_at: FieldValue.serverTimestamp()
      });
      writeMovement(transaction, names, operationId, {
        product_id: line.product_id,
        product_name: line.product_name,
        transaction_id: orderId,
        transaction_type: 'sale_paid',
        change_qty: -line.base_qty,
        stock_before: before,
        stock_after: after,
        revision: Number(order.revision || 1) + 1,
        operator
      });
    });

    transaction.update(orderRef, {
      payment_status: 'paid',
      status: 'completed',
      paid_at: FieldValue.serverTimestamp(),
      paid_by: operator.email,
      paid_by_uid: operator.uid,
      revision: Number(order.revision || 1) + 1
    });
    const result = { order_id: orderId };
    writeOperation(transaction, operationRef, operationId, 'pay_preorder', operator, result);
    return result;
  });
});

export const editTransaction = callable(async (data, operator) => {
  const names = collectionsFor(data.environment);
  const operationId = assertOperationId(data.operation_id);
  const transactionType = data.transaction_type === 'purchase' ? 'purchase' : 'sale';
  const transactionId = String(data.transaction_id || '').trim();
  const updates = assertItems(data.items);
  rejectDuplicateItems(updates);
  const recordRef = db.collection(transactionType === 'sale' ? names.orders : names.purchases).doc(transactionId);

  return db.runTransaction(async transaction => {
    const operationRef = db.collection(names.operations).doc(operationId);
    const [operationSnapshot, recordSnapshot] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(recordRef)
    ]);
    const existing = existingOperationResult(operationSnapshot);
    if (existing) return existing;
    if (!recordSnapshot.exists) throw new HttpsError('not-found', 'Transaksi tidak ditemukan.');

    const record = recordSnapshot.data();
    if (record.status === 'cancelled') throw new HttpsError('failed-precondition', 'Transaksi yang dibatalkan tidak dapat diedit.');
    const originalItems = record.items || [];
    if (hasDuplicateProducts(originalItems)) {
      throw new HttpsError('failed-precondition', 'Transaksi lama memiliki baris produk ganda dan perlu ditinjau sebelum diedit.', {
        kind: 'legacy-metadata-review',
        transaction_id: transactionId
      });
    }

    const isUnpaidPreorder = transactionType === 'sale'
      && (record.payment_status === 'unpaid' || record.status === 'unpaid');
    if (isUnpaidPreorder) {
      const productIds = updates.map(item => assertProductId(item.product_id));
      const originalById = new Map(originalItems.map(item => [assertProductId(item.product_id), item]));
      const productRefs = productIds.map(id => db.collection(names.products).doc(id));
      const productSnapshots = await Promise.all(productRefs.map(ref => transaction.get(ref)));
      const products = productMapFromSnapshots(productSnapshots, { allowArchived: true });

      productIds.forEach(productId => {
        const product = products.get(productId);
        if (!originalById.has(productId) && product.active === false) {
          throw new HttpsError('failed-precondition', 'Produk baru yang ditambahkan sudah diarsipkan.', {
            product_id: productId
          });
        }
      });

      const preorder = data.preorder && typeof data.preorder === 'object' ? data.preorder : {};
      const customerName = String(
        preorder.customer_name !== undefined ? preorder.customer_name : (record.customer_name || '')
      ).trim();
      const targetDate = String(
        preorder.target_date !== undefined ? preorder.target_date : (record.target_date || '')
      ).trim();
      const requestedCustomerType = String(
        preorder.customer_type !== undefined ? preorder.customer_type : (record.customer_type || 'regular')
      ).trim().toLowerCase();
      const validCustomerTypes = new Set(['regular', 'premium', 'star']);

      if (!customerName) {
        throw new HttpsError('invalid-argument', 'Nama pelanggan / catatan wajib diisi untuk pre-order.');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || targetDate < localDateString()) {
        throw new HttpsError('invalid-argument', 'Tanggal target pre-order harus hari ini atau setelahnya.');
      }
      if (!validCustomerTypes.has(requestedCustomerType)) {
        throw new HttpsError('invalid-argument', 'Tingkat harga pelanggan tidak valid.');
      }

      const newItems = updates.map(item => {
        const product = products.get(item.product_id);
        const original = originalById.get(item.product_id);
        const units = snapshotLine(item, product);
        const updatedMultiplier = units.unit_kind === 'bulk' ? Number(units.bulk_unit_conversion) : 1;
        const originalMultiplier = original
          ? (original.unit_kind === 'bulk' || original.selected_unit === 'bulk'
            ? Number(original.bulk_unit_conversion || 1)
            : 1)
          : 1;

        let unitPrice;
        if (original) {
          const originalUnitPrice = finiteNumber(original.unit_price, 'Harga jual', { min: 0, allowZero: true });
          unitPrice = originalUnitPrice * updatedMultiplier / originalMultiplier;
        } else {
          unitPrice = finiteNumber(item.unit_price, 'Harga jual', { min: 0, allowZero: true });
          const minimumPrice = Number(product.price_star || 0) * updatedMultiplier;
          if (unitPrice < minimumPrice) {
            throw new InventoryValidationError('Harga jual tidak boleh lebih rendah dari Harga Bintang.', {
              product_id: item.product_id,
              minimum_price: minimumPrice,
              unit_price: unitPrice
            });
          }
        }

        const buyPrice = original
          ? finiteNumber(original.buy_price ?? (Number(product.cost_price || 0) * originalMultiplier), 'Harga modal', {
            min: 0,
            allowZero: true
          }) * updatedMultiplier / originalMultiplier
          : Number(product.cost_price || 0) * updatedMultiplier;

        return {
          product_id: item.product_id,
          product_name: product.name || item.product_name || item.product_id,
          sku: item.product_id,
          ...units,
          selected_unit: units.unit_kind,
          unit_price: unitPrice,
          buy_price: buyPrice,
          total: Math.ceil(unitPrice * units.qty)
        };
      });

      const revision = Number(record.revision || 1) + 1;
      transaction.update(recordRef, {
        items: newItems,
        grand_total: newItems.reduce((sum, item) => sum + Number(item.total || 0), 0),
        customer_name: customerName,
        customer_type: requestedCustomerType,
        target_date: targetDate,
        payment_status: 'unpaid',
        status: 'unpaid',
        revision,
        change_logs: [
          ...(record.change_logs || []),
          {
            edited_at: new Date().toISOString(),
            edited_by: operator.email,
            previous_items: originalItems,
            new_items: newItems
          }
        ]
      });
      const result = { transaction_id: transactionId, revision };
      writeOperation(transaction, operationRef, operationId, 'edit_sale', operator, result);
      return result;
    }

    const updateMap = new Map(updates.map(item => [item.product_id, item]));
    const productIds = originalItems.map(item => assertProductId(item.product_id));
    const originalProductIds = new Set(productIds);
    const unexpectedProduct = updates.find(item => !originalProductIds.has(item.product_id));
    if (unexpectedProduct) {
      throw new HttpsError('invalid-argument', 'Edit transaksi tidak dapat menambahkan produk baru.', {
        product_id: unexpectedProduct.product_id
      });
    }
    const productRefs = productIds.map(id => db.collection(names.products).doc(id));
    const productSnapshots = await Promise.all(productRefs.map(ref => transaction.get(ref)));
    const products = productMapFromSnapshots(productSnapshots, { allowArchived: true });

    const hydratedOriginals = originalItems.map(item => hydrateHistoricalLine(item, products.get(item.product_id), transactionType));
    const newItems = hydratedOriginals.map(original => {
      const update = updateMap.get(original.product_id);
      if (!update) return original;
      const units = editedLineSnapshot(original, update);
      const originalMultiplier = original.unit_kind === 'bulk' ? Number(original.bulk_unit_conversion) : 1;
      const updatedMultiplier = units.unit_kind === 'bulk' ? Number(units.bulk_unit_conversion) : 1;
      if (transactionType === 'sale') {
        const originalUnitPrice = finiteNumber(original.unit_price, 'Harga jual', { min: 0, allowZero: true });
        const originalBuyPrice = finiteNumber(original.buy_price ?? 0, 'Harga modal', { min: 0, allowZero: true });
        const unitPrice = originalUnitPrice * updatedMultiplier / originalMultiplier;
        const buyPrice = originalBuyPrice * updatedMultiplier / originalMultiplier;
        return {
          ...original,
          ...units,
          selected_unit: units.unit_kind,
          unit_price: unitPrice,
          buy_price: buyPrice,
          total: Math.ceil(units.qty * unitPrice)
        };
      }
      const originalCost = finiteNumber(original.cost_per_unit ?? original.unit_price ?? 0, 'Harga beli', { min: 0, allowZero: true });
      const costPerUnit = originalCost * updatedMultiplier / originalMultiplier;
      return {
        ...original,
        ...units,
        cost_per_unit: costPerUnit,
        total: Math.ceil(units.qty * costPerUnit)
      };
    });

    const shouldAdjustInventory = transactionType === 'purchase'
      || (record.payment_status !== 'unpaid' && record.status !== 'unpaid');
    const deltas = new Map();
    hydratedOriginals.forEach((original, index) => {
      const oldBase = storedBaseQuantity(original);
      const newBase = storedBaseQuantity(newItems[index]);
      const delta = transactionType === 'sale' ? oldBase - newBase : newBase - oldBase;
      if (Math.abs(delta) > 1e-9 && shouldAdjustInventory) deltas.set(original.product_id, delta);
    });

    const changedProductIds = [...deltas.keys()];
    const inventoryRefs = changedProductIds.map(id => db.collection(names.inventory).doc(id));
    const inventorySnapshots = await Promise.all(inventoryRefs.map(ref => transaction.get(ref)));
    const insufficient = [];
    changedProductIds.forEach((productId, index) => {
      const before = currentStock(inventorySnapshots[index]);
      const after = before + deltas.get(productId);
      if (after < 0) {
        insufficient.push({
          product_id: productId,
          product_name: products.get(productId)?.name || productId,
          demanded_base: -deltas.get(productId),
          available_base: before,
          delta_base: -after,
          base_unit: products.get(productId)?.base_unit
        });
      }
    });
    if (insufficient.length) throw makeInsufficientError(insufficient, 'Perubahan transaksi akan membuat stok negatif.');

    const revision = Number(record.revision || 1) + 1;
    changedProductIds.forEach((productId, index) => {
      const before = currentStock(inventorySnapshots[index]);
      const delta = deltas.get(productId);
      const after = before + delta;
      transaction.set(inventoryRefs[index], {
        product_id: productId,
        current_stock_base: after,
        updated_at: FieldValue.serverTimestamp()
      }, { merge: true });
      writeMovement(transaction, names, operationId, {
        product_id: productId,
        product_name: products.get(productId)?.name,
        transaction_id: transactionId,
        transaction_type: `${transactionType}_updated`,
        change_qty: delta,
        stock_before: before,
        stock_after: after,
        revision,
        operator
      });
    });

    transaction.update(recordRef, {
      items: newItems,
      grand_total: newItems.reduce((sum, item) => sum + Number(item.total || 0), 0),
      revision,
      change_logs: [
        ...(record.change_logs || []),
        {
          edited_at: new Date().toISOString(),
          edited_by: operator.email,
          previous_items: originalItems,
          new_items: newItems
        }
      ]
    });
    const result = { transaction_id: transactionId, revision };
    writeOperation(transaction, operationRef, operationId, `edit_${transactionType}`, operator, result);
    return result;
  });
});

export const cancelTransaction = callable(async (data, operator) => {
  const names = collectionsFor(data.environment);
  const operationId = assertOperationId(data.operation_id);
  const transactionType = data.transaction_type === 'purchase' ? 'purchase' : 'sale';
  const transactionId = String(data.transaction_id || '').trim();
  const recordRef = db.collection(transactionType === 'sale' ? names.orders : names.purchases).doc(transactionId);

  return db.runTransaction(async transaction => {
    const operationRef = db.collection(names.operations).doc(operationId);
    const [operationSnapshot, recordSnapshot] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(recordRef)
    ]);
    const existing = existingOperationResult(operationSnapshot);
    if (existing) return existing;
    if (!recordSnapshot.exists) throw new HttpsError('not-found', 'Transaksi tidak ditemukan.');

    const record = recordSnapshot.data();
    if (record.status === 'cancelled') throw new HttpsError('already-exists', 'Transaksi sudah dibatalkan.');
    const items = record.items || [];
    const productIds = [...new Set(items.map(item => assertProductId(item.product_id)))];
    const productRefs = productIds.map(id => db.collection(names.products).doc(id));
    const productSnapshots = await Promise.all(productRefs.map(ref => transaction.get(ref)));
    const products = productMapFromSnapshots(productSnapshots, { allowArchived: true });
    const aggregatedLines = aggregateHistoricalLines(items, item => transactionType === 'purchase'
      ? legacyPurchaseBaseQuantity(item, products.get(item.product_id))
      : storedBaseQuantity(item));
    const inventoryWasChanged = transactionType === 'purchase'
      || (record.payment_status !== 'unpaid' && record.status !== 'unpaid');
    const inventoryRefs = inventoryWasChanged
      ? aggregatedLines.map(line => db.collection(names.inventory).doc(line.product_id))
      : [];
    const inventorySnapshots = await Promise.all(inventoryRefs.map(ref => transaction.get(ref)));

    const insufficient = [];
    if (transactionType === 'purchase') {
      aggregatedLines.forEach((line, index) => {
        const available = currentStock(inventorySnapshots[index]);
        if (available < line.base_qty) {
          insufficient.push({
            product_id: line.product_id,
            product_name: line.product_name || products.get(line.product_id)?.name || line.product_id,
            demanded_base: line.base_qty,
            available_base: available,
            delta_base: line.base_qty - available,
            base_unit: products.get(line.product_id)?.base_unit
          });
        }
      });
    }
    if (insufficient.length) throw makeInsufficientError(insufficient, 'Pembatalan pembelian akan membuat stok negatif.');

    const revision = Number(record.revision || 1) + 1;
    if (inventoryWasChanged) {
      aggregatedLines.forEach((line, index) => {
        const before = currentStock(inventorySnapshots[index]);
        const delta = transactionType === 'sale' ? line.base_qty : -line.base_qty;
        const after = before + delta;
        transaction.set(inventoryRefs[index], {
          product_id: line.product_id,
          current_stock_base: after,
          updated_at: FieldValue.serverTimestamp()
        }, { merge: true });
        writeMovement(transaction, names, operationId, {
          product_id: line.product_id,
          product_name: line.product_name || products.get(line.product_id)?.name,
          transaction_id: transactionId,
          transaction_type: `${transactionType}_cancelled`,
          change_qty: delta,
          stock_before: before,
          stock_after: after,
          revision,
          operator
        });
      });
    }

    transaction.update(recordRef, {
      status: 'cancelled',
      cancelled_at: FieldValue.serverTimestamp(),
      cancelled_by: operator.email,
      cancelled_by_uid: operator.uid,
      revision
    });
    const result = { transaction_id: transactionId, revision };
    writeOperation(transaction, operationRef, operationId, `cancel_${transactionType}`, operator, result);
    return result;
  });
}, ['superadmin']);

export const adjustStock = callable(async (data, operator) => {
  const names = collectionsFor(data.environment);
  const operationId = assertOperationId(data.operation_id);
  const productId = assertProductId(data.product_id);
  const expected = finiteNumber(data.expected_current_stock, 'Stok sebelumnya', { min: 0, allowZero: true });
  const requestedStock = finiteNumber(data.new_stock, 'Stok baru', { min: 0, allowZero: true });
  const kind = data.adjustment_kind;
  if (!['manual_sale', 'manual_purchase', 'stock_loss', 'stock_count'].includes(kind)) {
    throw new HttpsError('invalid-argument', 'Jenis penyesuaian stok tidak valid.');
  }

  return db.runTransaction(async transaction => {
    const operationRef = db.collection(names.operations).doc(operationId);
    const productRef = db.collection(names.products).doc(productId);
    const inventoryRef = db.collection(names.inventory).doc(productId);
    const date = localDateString();
    const counterRef = kind === 'manual_sale'
      ? db.collection(names.counters).doc(`orders_${date}`)
      : kind === 'manual_purchase'
        ? db.collection(names.counters).doc(`purchases_${date}`)
        : null;
    const transactionPrefix = kind === 'manual_sale'
      ? `${date}-`
      : kind === 'manual_purchase'
        ? `PUR-${date}-`
        : null;
    const transactionCollection = kind === 'manual_sale'
      ? db.collection(names.orders)
      : kind === 'manual_purchase'
        ? db.collection(names.purchases)
        : null;
    const [operationSnapshot, productSnapshot, inventorySnapshot, counterSnapshot] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(productRef),
      transaction.get(inventoryRef),
      counterRef ? transaction.get(counterRef) : Promise.resolve(null)
    ]);
    const existing = existingOperationResult(operationSnapshot);
    if (existing) return existing;
    const products = productMapFromSnapshots([productSnapshot]);
    const product = products.get(productId);
    const before = currentStock(inventorySnapshot);
    if (Math.abs(before - expected) > 1e-9) {
      throw new HttpsError('aborted', 'Stok telah berubah sejak formulir dibuka. Muat ulang dan coba lagi.', {
        kind: 'stale-stock',
        product_id: productId,
        expected_stock: expected,
        current_stock: before
      });
    }

    const delta = requestedStock - before;
    if (Math.abs(delta) <= 1e-9) throw new HttpsError('failed-precondition', 'Tidak ada perubahan stok.');
    if ((kind === 'manual_sale' || kind === 'stock_loss') && delta >= 0) {
      throw new HttpsError('invalid-argument', 'Jenis penyesuaian ini harus mengurangi stok.');
    }
    if (kind === 'manual_purchase' && delta <= 0) {
      throw new HttpsError('invalid-argument', 'Pembelian manual harus menambah stok.');
    }

    const units = snapshotLine({ qty: Math.abs(delta), unit_kind: 'base' }, product);
    let linkedTransactionId = `ADJ-${date}-${operationId.slice(0, 8)}`;
    const transactionSequence = transactionCollection
      ? await allocateDailyId(transaction, transactionCollection, counterSnapshot, transactionPrefix)
      : null;

    if (kind === 'manual_sale') {
      const { id, nextCount, ref: orderRef } = transactionSequence;
      linkedTransactionId = id;
      const priceTier = ['regular', 'premium', 'star'].includes(data.price_tier) ? data.price_tier : 'regular';
      const unitPrice = Number(product[`price_${priceTier}`] || 0);
      transaction.set(counterRef, { count: nextCount, updated_at: FieldValue.serverTimestamp() }, { merge: true });
      transaction.set(orderRef, {
        id: linkedTransactionId,
        items: [{
          product_id: productId,
          product_name: product.name || productId,
          sku: productId,
          ...units,
          selected_unit: 'base',
          unit_price: unitPrice,
          buy_price: Number(product.cost_price || 0),
          total: Math.ceil(units.qty * unitPrice)
        }],
        grand_total: Math.ceil(units.qty * unitPrice),
        customer_type: priceTier,
        order_date: data.order_date || date,
        source: 'stock_adjustment',
        payment_status: 'paid',
        status: 'completed',
        revision: 1,
        operation_id: operationId,
        created_by: operator.email,
        created_by_uid: operator.uid,
        created_at: FieldValue.serverTimestamp()
      });
    } else if (kind === 'manual_purchase') {
      const { id, nextCount, ref: purchaseRef } = transactionSequence;
      linkedTransactionId = id;
      const costPerUnit = finiteNumber(data.cost_per_unit, 'Harga beli', { min: 0, allowZero: true });
      transaction.set(counterRef, { count: nextCount, updated_at: FieldValue.serverTimestamp() }, { merge: true });
      transaction.set(purchaseRef, {
        id: linkedTransactionId,
        items: [{
          product_id: productId,
          product_name: product.name || productId,
          ...units,
          cost_per_unit: costPerUnit,
          total: Math.ceil(units.qty * costPerUnit)
        }],
        grand_total: Math.ceil(units.qty * costPerUnit),
        source: 'stock_adjustment',
        status: 'completed',
        revision: 1,
        operation_id: operationId,
        created_by: operator.email,
        created_by_uid: operator.uid,
        created_at: FieldValue.serverTimestamp()
      });
      transaction.set(productRef, {
        cost_price: costPerUnit,
        price_star: costPerUnit,
        updated_at: FieldValue.serverTimestamp()
      }, { merge: true });
    } else if (kind === 'stock_loss') {
      const reason = String(data.reason || '').trim();
      if (!reason) throw new HttpsError('invalid-argument', 'Alasan kehilangan stok diperlukan.');
      linkedTransactionId = `LOSS-${date}-${operationId.slice(0, 12)}`;
      transaction.set(db.collection(names.losses).doc(linkedTransactionId), {
        id: linkedTransactionId,
        product_id: productId,
        product_name: product.name || productId,
        qty: Math.abs(delta),
        base_qty: Math.abs(delta),
        base_unit: units.base_unit,
        reason,
        cost_price: Number(product.cost_price || 0),
        estimated_loss: Math.abs(delta) * Number(product.cost_price || 0),
        operation_id: operationId,
        operator: operator.email,
        operator_uid: operator.uid,
        created_at: FieldValue.serverTimestamp()
      });
    }

    transaction.set(inventoryRef, {
      product_id: productId,
      current_stock_base: requestedStock,
      updated_at: FieldValue.serverTimestamp()
    }, { merge: true });
    writeMovement(transaction, names, operationId, {
      product_id: productId,
      product_name: product.name,
      transaction_id: linkedTransactionId,
      transaction_type: kind,
      change_qty: delta,
      stock_before: before,
      stock_after: requestedStock,
      reason: data.reason || null,
      operator
    });

    const result = { transaction_id: linkedTransactionId, stock_after: requestedStock };
    writeOperation(transaction, operationRef, operationId, kind, operator, result);
    return result;
  });
});

export const repackStock = callable(async (data, operator) => {
  const names = collectionsFor(data.environment);
  const operationId = assertOperationId(data.operation_id);
  const sourceId = assertProductId(data.from_sku);
  const targetId = assertProductId(data.to_sku);
  if (sourceId === targetId) throw new HttpsError('invalid-argument', 'Produk sumber dan target harus berbeda.');
  const qty = finiteNumber(data.qty_to_open, 'Jumlah kemasan', { min: 0, allowZero: false });
  const conversion = finiteNumber(data.conversion_rate, 'Konversi', { min: 0, allowZero: false });

  return db.runTransaction(async transaction => {
    const operationRef = db.collection(names.operations).doc(operationId);
    const sourceProductRef = db.collection(names.products).doc(sourceId);
    const targetProductRef = db.collection(names.products).doc(targetId);
    const sourceInventoryRef = db.collection(names.inventory).doc(sourceId);
    const targetInventoryRef = db.collection(names.inventory).doc(targetId);
    const [operationSnapshot, sourceProductSnapshot, targetProductSnapshot, sourceInventorySnapshot, targetInventorySnapshot] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(sourceProductRef),
      transaction.get(targetProductRef),
      transaction.get(sourceInventoryRef),
      transaction.get(targetInventoryRef)
    ]);
    const existing = existingOperationResult(operationSnapshot);
    if (existing) return existing;
    const products = productMapFromSnapshots([sourceProductSnapshot, targetProductSnapshot]);
    const sourceProduct = products.get(sourceId);
    const configuredConversion = normalizedProductUnits(sourceProduct).conversion;
    if (Math.abs(configuredConversion - conversion) > 1e-9) {
      throw new HttpsError('failed-precondition', 'Konversi produk telah berubah. Muat ulang formulir repack.', {
        kind: 'stale-conversion',
        configured_conversion: configuredConversion
      });
    }

    const sourceBefore = currentStock(sourceInventorySnapshot);
    const targetBefore = currentStock(targetInventorySnapshot);
    if (sourceBefore < qty) {
      throw makeInsufficientError([{
        product_id: sourceId,
        product_name: sourceProduct.name || sourceId,
        demanded_base: qty,
        available_base: sourceBefore,
        delta_base: qty - sourceBefore,
        base_unit: sourceProduct.base_unit
      }], 'Stok sumber tidak mencukupi untuk repack.');
    }

    const addition = qty * conversion;
    const sourceAfter = sourceBefore - qty;
    const targetAfter = targetBefore + addition;
    const repackId = `REPACK-${localDateString()}-${operationId.slice(0, 8)}`;
    transaction.update(sourceInventoryRef, {
      current_stock_base: sourceAfter,
      updated_at: FieldValue.serverTimestamp()
    });
    transaction.set(targetInventoryRef, {
      product_id: targetId,
      current_stock_base: targetAfter,
      updated_at: FieldValue.serverTimestamp()
    }, { merge: true });
    writeMovement(transaction, names, operationId, {
      product_id: sourceId,
      product_name: sourceProduct.name,
      transaction_id: repackId,
      transaction_type: 'repack_source',
      change_qty: -qty,
      stock_before: sourceBefore,
      stock_after: sourceAfter,
      operator
    });
    writeMovement(transaction, names, operationId, {
      product_id: targetId,
      product_name: products.get(targetId)?.name,
      transaction_id: repackId,
      transaction_type: 'repack_target',
      change_qty: addition,
      stock_before: targetBefore,
      stock_after: targetAfter,
      operator
    });

    const result = { transaction_id: repackId, source_stock: sourceAfter, target_stock: targetAfter };
    writeOperation(transaction, operationRef, operationId, 'repack', operator, result);
    return result;
  });
});

export const inventoryHealth = callable(async (data) => {
  const names = collectionsFor(data.environment);
  const [inventorySnapshot, movementSnapshot] = await Promise.all([
    db.collection(names.inventory).get(),
    db.collection(names.movements).orderBy('created_at', 'asc').get()
  ]);
  const movementsByProduct = new Map();
  movementSnapshot.docs.forEach(document => {
    const movement = document.data();
    const productId = movement.product_id;
    if (!movementsByProduct.has(productId)) movementsByProduct.set(productId, []);
    movementsByProduct.get(productId).push({ id: document.id, ...movement });
  });

  const anomalies = [];
  inventorySnapshot.docs.forEach(document => {
    const actual = Number(document.data().current_stock_base);
    if (!Number.isFinite(actual) || actual < 0) {
      anomalies.push({ kind: 'invalid-current-stock', product_id: document.id, actual });
    }
    const movements = movementsByProduct.get(document.id) || [];
    movements.forEach((movement, index) => {
      const before = Number(movement.stock_before);
      const after = Number(movement.stock_after);
      const delta = Number(movement.change_qty);
      if (![before, after, delta].every(Number.isFinite) || Math.abs(before + delta - after) > 1e-9) {
        anomalies.push({ kind: 'invalid-movement-math', product_id: document.id, movement_id: movement.id });
      }
      if (index > 0 && Math.abs(Number(movements[index - 1].stock_after) - before) > 1e-9) {
        anomalies.push({ kind: 'movement-chain-gap', product_id: document.id, movement_id: movement.id });
      }
    });
    if (movements.length && Math.abs(Number(movements.at(-1).stock_after) - actual) > 1e-9) {
      anomalies.push({ kind: 'inventory-log-mismatch', product_id: document.id, actual, logged: movements.at(-1).stock_after });
    }
  });
  const inventoryProductIds = new Set(inventorySnapshot.docs.map(document => document.id));
  movementsByProduct.forEach((movements, productId) => {
    if (!inventoryProductIds.has(productId)) {
      anomalies.push({
        kind: 'missing-inventory-record',
        product_id: productId,
        latest_movement_id: movements.at(-1)?.id || null
      });
    }
  });

  return {
    checked_inventory: inventorySnapshot.size,
    checked_movements: movementSnapshot.size,
    anomalies
  };
}, ['superadmin']);
