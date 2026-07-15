import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, doc, getDoc, updateDoc } from 'firebase/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Read .env file to load Firebase configuration keys
const envPath = path.resolve(__dirname, '../.env');
if (!fs.existsSync(envPath)) {
    console.error("Error: .env file not found!");
    process.exit(1);
}

const envConfig = fs.readFileSync(envPath, 'utf-8');
envConfig.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        process.env[key] = value;
    }
});

const firebaseConfig = {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
    measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const askQuestion = (query) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => {
        rl.question(query, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
};

async function runCorrection() {
    console.log("=== Firebase Data Correction (Matching Units Fix) ===");
    console.log(`Project ID: ${firebaseConfig.projectId}\n`);

    const email = await askQuestion("Enter your staff/admin email: ");
    const password = await askQuestion("Enter password: ");

    console.log("\nLogging in...");
    await signInWithEmailAndPassword(auth, email, password);
    console.log("Authenticated successfully!");

    // 1. Correct Products: Set bulk_unit_conversion = 1 where units match case-insensitively
    for (const suffix of ['', '_test']) {
        const colName = 'products' + suffix;
        console.log(`\nChecking ${colName}...`);
        const productsSnap = await getDocs(collection(db, colName));
        
        let fixedProducts = 0;
        for (const d of productsSnap.docs) {
            const product = d.data();
            const baseUnit = (product.base_unit || "").toLowerCase().trim();
            const bulkUnit = (product.bulk_unit_name || "").toLowerCase().trim();
            
            if (baseUnit && bulkUnit && baseUnit === bulkUnit && product.bulk_unit_conversion !== 1) {
                console.log(`Fixing SKU ${product.sku} (${product.name}): bulk_unit_conversion ${product.bulk_unit_conversion} -> 1`);
                const docRef = doc(db, colName, d.id);
                await updateDoc(docRef, { bulk_unit_conversion: 1 });
                fixedProducts++;
            }
        }
        console.log(`Fixed ${fixedProducts} products in ${colName}.`);
    }

    // 2. Correct Inventory Stock Level for Tepung Tapioka (SKU: 001-TapiokaMatahari)
    // We need to subtract 90 base units because the purchase created 100 instead of 10.
    for (const suffix of ['', '_test']) {
        const colName = 'inventory' + suffix;
        console.log(`\nChecking stock level in ${colName}...`);
        const invRef = doc(db, colName, '001-TapiokaMatahari');
        const snap = await getDoc(invRef);
        if (snap.exists()) {
            const currentStock = snap.data().current_stock_base || 0;
            const correctedStock = Math.max(0, currentStock - 90);
            console.log(`Correcting stock for 001-TapiokaMatahari in ${colName}: ${currentStock} -> ${correctedStock}`);
            await updateDoc(invRef, { current_stock_base: correctedStock });
        } else {
            console.log(`No inventory record found for 001-TapiokaMatahari in ${colName}.`);
        }
    }

    console.log("\n=== Correction Completed Successfully! ===");
}

runCorrection().catch(err => {
    console.error("\nCorrection failed with error:", err.message);
    process.exit(1);
});
