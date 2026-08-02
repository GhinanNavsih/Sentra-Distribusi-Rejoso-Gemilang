import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { inspectTimestampMaps, restoreTimestamps } from './migrationTimestampRepair.js';

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

if (apply && !confirmApply) {
  throw new Error('Apply mode requires --confirm. Run without --apply first to perform a dry run.');
}

const env = readEnv();
const projectId = process.env.GOOGLE_CLOUD_PROJECT || env.VITE_FIREBASE_PROJECT_ID;
if (!projectId) throw new Error('Firebase project ID tidak ditemukan.');

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

const environmentCollections = environment => {
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

const inspectEnvironment = async environment => {
  const collections = environmentCollections(environment);
  const products = await readCollection(collections.products);
  const inventory = await readCollection(collections.inventory);
  const historical = Object.fromEntries(await Promise.all(
    collections.historical.map(async collectionName => [collectionName, await readCollection(collectionName)])
  ));
  const collectionDocuments = {
    [collections.products]: products,
    [collections.inventory]: inventory,
    ...historical
  };
  const collectionReports = Object.fromEntries(Object.entries(collectionDocuments).map(([collectionName, documents]) => [
    collectionName,
    inspectTimestampMaps(documents)
  ]));
  const matches = Object.entries(collectionReports).flatMap(([collectionName, report]) => report.matches.map(match => ({
    collection: collectionName,
    ...match
  })));

  return {
    environment,
    collections,
    collectionDocuments,
    collectionReports,
    matches,
    summary: {
      documents: Object.values(collectionDocuments).reduce((sum, documents) => sum + documents.length, 0),
      documents_with_timestamp_maps: Object.values(collectionReports).reduce((sum, report) => sum + report.documentsWithTimestampMaps, 0),
      timestamp_maps: matches.length,
      stock_before: stockTotal(inventory),
      stock_after: stockTotal(inventory)
    },
    errors: []
  };
};

const applyEnvironment = async inspection => {
  if (inspection.errors.length) throw new Error(`Perbaikan ${inspection.environment} dibatalkan karena ${inspection.errors.length} error validasi.`);

  const writer = db.bulkWriter();
  Object.entries(inspection.collectionDocuments).forEach(([collectionName, documents]) => {
    documents.forEach(document => {
      const repaired = [];
      const repairedData = restoreTimestamps(document.data, '', repaired);
      if (!repaired.length) return;
      writer.set(db.collection(collectionName).doc(document.id), repairedData);
    });
  });

  const manifestId = `timestamp_repair_v1_${inspection.environment}_${Date.now()}`;
  writer.set(db.collection('timestamp_repair_manifests').doc(manifestId), {
    version: 1,
    environment: inspection.environment,
    project_id: projectId,
    created_at: FieldValue.serverTimestamp(),
    summary: inspection.summary,
    affected_collections: Object.fromEntries(Object.entries(inspection.collectionReports).map(([collectionName, report]) => [
      collectionName,
      {
        documents: report.documents,
        documents_with_timestamp_maps: report.documentsWithTimestampMaps,
        timestamp_maps: report.timestampMaps
      }
    ]))
  });
  await writer.close();
};

const verifyEnvironment = async inspection => {
  const verified = await inspectEnvironment(inspection.environment);
  const errors = [];
  if (verified.summary.documents !== inspection.summary.documents) errors.push('Jumlah dokumen berubah.');
  if (verified.summary.timestamp_maps !== 0) errors.push(`${verified.summary.timestamp_maps} timestamp map masih tersisa.`);
  if (Math.abs(verified.summary.stock_after - inspection.summary.stock_before) > 1e-9) errors.push('Total stok berubah.');
  return { errors, summary: { ...inspection.summary, stock_after: verified.summary.stock_after } };
};

const serializeInspection = inspection => ({
  environment: inspection.environment,
  summary: inspection.summary,
  errors: inspection.errors,
  collections: Object.fromEntries(Object.entries(inspection.collectionReports).map(([collectionName, report]) => [
    collectionName,
    {
      documents: report.documents,
      documents_with_timestamp_maps: report.documentsWithTimestampMaps,
      timestamp_maps: report.timestampMaps
    }
  ])),
  sample_matches: inspection.matches.slice(0, 25)
});

const main = async () => {
  const environments = requestedEnvironment === 'all' ? ['production', 'staging'] : [requestedEnvironment];
  if (!environments.every(environment => ['production', 'staging'].includes(environment))) {
    throw new Error('--environment harus production, staging, atau all.');
  }

  const inspections = await Promise.all(environments.map(inspectEnvironment));
  const report = {
    mode: apply ? 'apply' : 'dry-run',
    project_id: projectId,
    environments: inspections.map(serializeInspection)
  };
  if (reportPath) fs.writeFileSync(path.resolve(process.cwd(), reportPath), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  const validationErrors = inspections.flatMap(inspection => inspection.errors);
  if (validationErrors.length) throw new Error(`Perbaikan dihentikan: ditemukan ${validationErrors.length} error validasi.`);
  if (!apply) {
    console.log('Dry run selesai. Tidak ada data yang diubah.');
    return;
  }

  for (const inspection of inspections) await applyEnvironment(inspection);
  for (const inspection of inspections) {
    const verification = await verifyEnvironment(inspection);
    if (verification.errors.length) throw new Error(`Verifikasi ${inspection.environment} gagal: ${verification.errors.join(' ')}`);
    console.log(`${inspection.environment}: timestamp repair selesai.`, verification.summary);
  }
};

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
