import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read .env file to load Firebase configuration keys
const envPath = path.resolve(__dirname, '../.env');
if (!fs.existsSync(envPath)) {
    console.error("Error: .env file not found at the project root!");
    process.exit(1);
}

const envConfig = fs.readFileSync(envPath, 'utf-8');
const env = {};
envConfig.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        env[key] = value;
    }
});

const firebaseConfig = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
    measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function findDuplicateUnits() {
    console.log("Scanning Firebase products collections for identical base/bulk unit names...");
    const report = {
        products: [],
        products_test: []
    };

    for (const colName of ['products', 'products_test']) {
        const snap = await getDocs(collection(db, colName));
        for (const doc of snap.docs) {
            const product = doc.data();
            const baseUnit = (product.base_unit || "").toLowerCase().trim();
            const bulkUnit = (product.bulk_unit_name || "").toLowerCase().trim();

            if (baseUnit && bulkUnit && baseUnit === bulkUnit) {
                report[colName].push({
                    sku: product.sku,
                    name: product.name,
                    base_unit: product.base_unit,
                    bulk_unit_name: product.bulk_unit_name,
                    bulk_unit_conversion: product.bulk_unit_conversion || 1,
                    category: product.category || ""
                });
            }
        }
    }

    const outputPath = path.resolve(__dirname, 'duplicate_units_report.json');
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`\nScan complete! Found identical unit names in:`);
    console.log(`- 'products' collection: ${report.products.length} items`);
    console.log(`- 'products_test' collection: ${report.products_test.length} items`);
    console.log(`\nReport successfully saved to: ${outputPath}\n`);
    console.log("JSON Output:");
    console.log(JSON.stringify(report, null, 2));
}

findDuplicateUnits().catch(console.error);
