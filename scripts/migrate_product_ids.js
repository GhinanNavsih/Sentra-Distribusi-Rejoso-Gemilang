import fs from 'node:fs';
import path from 'node:path';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { fileURLToPath } from 'node:url';
import {
  buildProductMapping,
  buildHistoricalReconciliation,
  buildMappingFromPlan,
  documentPathKey,
  findUnresolvedReferences,
  reconciliationFromPlan,
  resolveInventoryProductId,
  rewriteHistoricalReferences,
  rewriteProductReferences
} from './productIdMigration.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');

const readEnv = () => {
  const envPath = path.join(projectRoot, '.env');
  if (!fs.existsSync(envPath)) return {};
  return Object.fromEntries(fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const separator = line.indexOf('=');
      return separator > 0 ? [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] : null;
    })
    .filter(Boolean));
};

const args = new Set(process.argv.slice(2));
const argumentValue = (name, fallback) => process.argv.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const apply = args.has('--apply');
const confirmApply = args.has('--confirm');
const requestedEnvironment = argumentValue('--environment', 'all');
const reportPath = argumentValue('--report', null);
const planPath = argumentValue('--plan', null);

if (apply && !confirmApply) {
  throw new Error('Apply mode requires --confirm. Run without --apply first to perform a dry run.');
}
if (apply && !planPath) {
  throw new Error('Apply mode requires --plan=<dry-run-report.json>. Apply the exact reviewed dry-run plan.');
}
if (apply && reportPath && path.resolve(process.cwd(), reportPath) === path.resolve(process.cwd(), planPath)) {
  throw new Error('--report must be different from --plan so the reviewed plan is not overwritten.');
}

const env = readEnv();
const projectId = process.env.GOOGLE_CLOUD_PROJECT || env.VITE_FIREBASE_PROJECT_ID;
if (!projectId) throw new Error('Firebase project ID tidak ditemukan.');

const plan = planPath
  ? JSON.parse(fs.readFileSync(path.resolve(process.cwd(), planPath), 'utf8'))
  : null;
if (plan && plan.project_id !== projectId) {
  throw new Error(`Plan project ID (${plan.project_id}) berbeda dari project aktif (${projectId}).`);
}

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

const environmentCollections = (environment) => {
  const suffix = environment === 'staging' ? '_test' : '';
  return {
    products: `products${suffix}`,
    inventory: `inventory${suffix}`,
    historical: [
      `orders${suffix}`,
      `purchases${suffix}`,
      `stock_losses${suffix}`,
      `stock_movements${suffix}`,
      `inventory_operations${suffix}`
    ]
  };
};

const readCollection = async collectionName => {
  const snapshot = await db.collection(collectionName).get();
  return snapshot.docs.map(document => ({ id: document.id, data: document.data() }));
};

const stockTotal = documents => documents.reduce((sum, document) => {
  const value = Number(document.data?.current_stock_base || 0);
  return Number.isFinite(value) ? sum + value : sum;
}, 0);

const inspectEnvironment = async (environment, planEnvironment = null) => {
  const collections = environmentCollections(environment);
  const products = await readCollection(collections.products);
  const inventory = await readCollection(collections.inventory);
  const historical = Object.fromEntries(await Promise.all(
    collections.historical.map(async collectionName => [collectionName, await readCollection(collectionName)])
  ));

  const historicalDocuments = Object.entries(historical).flatMap(([collection, documents]) => documents.map(document => ({
    ...document,
    collection
  })));
  const mappingResult = planEnvironment
    ? buildMappingFromPlan(products, planEnvironment.mappings, planEnvironment.archived_products)
    : buildProductMapping(products, {
      reservedIds: new Set(products.map(document => document.id))
    });
  const reconciliation = planEnvironment
    ? reconciliationFromPlan(planEnvironment)
    : buildHistoricalReconciliation({
      historicalDocuments,
      products,
      mapping: mappingResult.mapping,
      reservedIds: new Set(products.map(document => document.id)),
      suffixFactory: undefined
    });
  const errors = [...mappingResult.errors];
  errors.push(...reconciliation.errors);
  const inventoryTargets = new Map();

  inventory.forEach(document => {
    const resolved = resolveInventoryProductId(document, mappingResult.mapping);
    if (resolved.error) {
      errors.push(resolved.error);
      return;
    }
    if (inventoryTargets.has(resolved.productId) && inventoryTargets.get(resolved.productId) !== document.id) {
      errors.push({ kind: 'duplicate-inventory-target', product_id: resolved.productId, inventory_ids: [inventoryTargets.get(resolved.productId), document.id] });
      return;
    }
    inventoryTargets.set(resolved.productId, document.id);
  });

  const unresolvedReferences = [];
  Object.entries(historical).forEach(([collectionName, documents]) => {
    documents.forEach(document => {
      const documentPath = documentPathKey(collectionName, document.id);
      const resolutions = reconciliation.resolutionsByDocument.get(documentPath) || new Map();
      const rewritten = rewriteHistoricalReferences(document.data, mappingResult.mapping, resolutions);
      unresolvedReferences.push(...findUnresolvedReferences(
        rewritten,
        mappingResult.mapping,
        documentPath
      ));
    });
  });
  if (unresolvedReferences.length) {
    errors.push(...unresolvedReferences.map(reference => ({ kind: 'unresolved-historical-reference', ...reference })));
  }

  if (planEnvironment) {
    const plannedSummary = planEnvironment.summary || {};
    if (plannedSummary.products !== products.length) {
      errors.push({ kind: 'plan-product-count-changed', planned: plannedSummary.products, actual: products.length });
    }
    if (plannedSummary.inventory !== inventory.length) {
      errors.push({ kind: 'plan-inventory-count-changed', planned: plannedSummary.inventory, actual: inventory.length });
    }
    if (plannedSummary.stock_before !== stockTotal(inventory)) {
      errors.push({ kind: 'plan-stock-total-changed', planned: plannedSummary.stock_before, actual: stockTotal(inventory) });
    }
  }

  return {
    environment,
    collections,
    products,
    inventory,
    historical,
    mapping: mappingResult.mapping,
    entries: mappingResult.entries,
    archivedProducts: reconciliation.archivedProducts,
    reconciliation,
    errors,
    summary: {
      products: products.length,
      inventory: inventory.length,
      historical_documents: Object.values(historical).reduce((sum, documents) => sum + documents.length, 0),
      archived_products: reconciliation.archivedProducts.length,
      products_after: products.length + reconciliation.archivedProducts.length,
      stock_before: stockTotal(inventory),
      stock_after: stockTotal(inventory)
    }
  };
};

const migratedProductData = (document, mapping) => {
  const targetId = mapping.get(document.id);
  const rewritten = rewriteProductReferences(document.data, mapping);
  const oldSku = document.data.sku;
  const legacySku = document.data.legacy_sku || (oldSku && oldSku !== targetId ? oldSku : null);
  const legacyProductId = document.data.legacy_product_id || (document.id !== targetId ? document.id : null);

  return {
    ...rewritten,
    sku: targetId,
    ...(legacySku ? { legacy_sku: legacySku } : {}),
    ...(legacyProductId ? { legacy_product_id: legacyProductId } : {}),
    id_migration_version: 1,
    id_migrated_at: FieldValue.serverTimestamp()
  };
};

const applyEnvironment = async (inspection) => {
  if (inspection.errors.length) throw new Error(`Migration ${inspection.environment} dibatalkan karena ${inspection.errors.length} error validasi.`);

  const writer = db.bulkWriter();
  const { collections, mapping } = inspection;

  inspection.products.forEach(document => {
    writer.set(db.collection(collections.products).doc(mapping.get(document.id)), migratedProductData(document, mapping));
  });
  inspection.archivedProducts.forEach(product => {
    writer.set(db.collection(collections.products).doc(product.id), {
      ...product.data,
      id_migrated_at: FieldValue.serverTimestamp()
    });
  });

  inspection.inventory.forEach(document => {
    const targetId = resolveInventoryProductId(document, mapping).productId;
    writer.set(db.collection(collections.inventory).doc(targetId), {
      ...rewriteProductReferences(document.data, mapping),
      product_id: targetId,
      id_migration_version: 1,
      id_migrated_at: FieldValue.serverTimestamp()
    });
  });

  Object.entries(inspection.historical).forEach(([collectionName, documents]) => {
    documents.forEach(document => {
      const documentPath = documentPathKey(collectionName, document.id);
      const resolutions = inspection.reconciliation.resolutionsByDocument.get(documentPath) || new Map();
      writer.set(
        db.collection(collectionName).doc(document.id),
        rewriteHistoricalReferences(document.data, mapping, resolutions)
      );
    });
  });

  const manifestId = `product_ids_v1_${inspection.environment}_${Date.now()}`;
  writer.set(db.collection('id_migration_manifests').doc(manifestId), {
    version: 1,
    environment: inspection.environment,
    project_id: projectId,
    created_at: FieldValue.serverTimestamp(),
    mappings: inspection.entries,
    archived_products: inspection.archivedProducts.map(product => ({
      id: product.id,
      legacy_id: product.legacy_id,
      name: product.name,
      data: product.data
    })),
    reconciliations: inspection.reconciliation.resolutions,
    summary: inspection.summary
  });

  await writer.close();

  const deleteWriter = db.bulkWriter();
  inspection.products.forEach(document => {
    const targetId = mapping.get(document.id);
    if (targetId !== document.id) deleteWriter.delete(db.collection(collections.products).doc(document.id));
  });
  inspection.inventory.forEach(document => {
    const targetId = resolveInventoryProductId(document, mapping).productId;
    if (targetId !== document.id) deleteWriter.delete(db.collection(collections.inventory).doc(document.id));
  });
  await deleteWriter.close();
};

const verifyEnvironment = async (inspection) => {
  const products = await readCollection(inspection.collections.products);
  const inventory = await readCollection(inspection.collections.inventory);
  const historical = Object.fromEntries(await Promise.all(
    inspection.collections.historical.map(async collectionName => [collectionName, await readCollection(collectionName)])
  ));
  const expectedProductIds = new Set(inspection.entries.map(entry => entry.new_id));
  inspection.archivedProducts.forEach(product => expectedProductIds.add(product.id));
  const actualProductIds = new Set(products.map(document => document.id));
  const staleProductIds = inspection.entries
    .map(entry => entry.old_id)
    .filter(oldId => oldId !== inspection.mapping.get(oldId) && actualProductIds.has(oldId));
  const errors = [];

  if (products.length !== inspection.summary.products_after) errors.push('Jumlah produk setelah rekonsiliasi tidak sesuai.');
  if (inventory.length !== inspection.inventory.length) errors.push('Jumlah inventori berubah.');
  if (expectedProductIds.size !== actualProductIds.size || [...expectedProductIds].some(id => !actualProductIds.has(id))) {
    errors.push('Set ID produk setelah migrasi tidak sesuai mapping.');
  }
  if (staleProductIds.length) errors.push(`Dokumen produk lama masih tersisa: ${staleProductIds.join(', ')}`);
  if (Math.abs(stockTotal(inventory) - inspection.summary.stock_before) > 1e-9) errors.push('Total stok berubah.');

  const archivedIds = new Set(inspection.archivedProducts.map(product => product.id));
  products.forEach(document => {
    if (archivedIds.has(document.id) && document.data.active !== false) {
      errors.push(`Produk legacy ${document.id} tidak berstatus arsip.`);
    }
  });
  Object.entries(historical).forEach(([collectionName, documents]) => {
    documents.forEach(document => {
      const unresolved = findUnresolvedReferences(
        document.data,
        inspection.mapping,
        documentPathKey(collectionName, document.id)
      );
      unresolved.forEach(reference => errors.push(`Referensi historis belum termigrasi: ${reference.path}=${reference.value}`));
    });
  });

  return { errors, summary: { ...inspection.summary, stock_after: stockTotal(inventory) } };
};

const serializeInspection = inspection => ({
  environment: inspection.environment,
  summary: inspection.summary,
  errors: inspection.errors,
  mappings: inspection.entries,
  archived_products: inspection.archivedProducts.map(product => ({
    id: product.id,
    legacy_id: product.legacy_id,
    name: product.name,
    data: product.data
  })),
  reconciliations: inspection.reconciliation.resolutions
});

const main = async () => {
  const environments = requestedEnvironment === 'all' ? ['production', 'staging'] : [requestedEnvironment];
  if (!environments.every(environment => ['production', 'staging'].includes(environment))) {
    throw new Error('--environment harus production, staging, atau all.');
  }

  const inspections = await Promise.all(environments.map(environment => inspectEnvironment(
    environment,
    plan?.environments?.find(item => item.environment === environment) || null
  )));
  const report = {
    mode: apply ? 'apply' : 'dry-run',
    project_id: projectId,
    environments: inspections.map(serializeInspection)
  };

  if (reportPath) fs.writeFileSync(path.resolve(process.cwd(), reportPath), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  const validationErrors = inspections.flatMap(inspection => inspection.errors);
  if (validationErrors.length) {
    throw new Error(`Migration dihentikan: ditemukan ${validationErrors.length} error validasi.`);
  }
  if (!apply) {
    console.log('Dry run selesai. Tidak ada data yang diubah.');
    return;
  }

  for (const inspection of inspections) await applyEnvironment(inspection);
  for (const inspection of inspections) {
    const verification = await verifyEnvironment(inspection);
    if (verification.errors.length) throw new Error(`Verifikasi ${inspection.environment} gagal: ${verification.errors.join(' ')}`);
    console.log(`${inspection.environment}: migrasi selesai.`, verification.summary);
  }
};

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
