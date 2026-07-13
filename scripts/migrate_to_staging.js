import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Read .env file to load Firebase configuration keys
const envPath = path.resolve(__dirname, '../.env');
if (!fs.existsSync(envPath)) {
    console.error("Error: .env file not found at the project root!");
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

// 2. Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Helper function to prompt user for credentials
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

async function runMigration() {
    console.log("=== Firebase Data Migration (Production -> Staging/Testing) ===");
    console.log(`Project: ${firebaseConfig.projectId}\n`);

    // 3. Prompt for authenticated credentials
    const email = await askQuestion("Enter your staff/admin email: ");
    const password = await askQuestion("Enter password: ");

    console.log("\nLogging in...");
    await signInWithEmailAndPassword(auth, email, password);
    console.log("Authenticated successfully!");

    // 4. Migrate Products: 'products' -> 'products_test'
    console.log("\n1. Migrating Products...");
    const productsSnap = await getDocs(collection(db, "products"));
    console.log(`Found ${productsSnap.size} products in 'products'.`);
    
    let productsCopied = 0;
    for (const d of productsSnap.docs) {
        const productData = d.data();
        const targetDocRef = doc(db, "products_test", d.id);
        await setDoc(targetDocRef, productData);
        productsCopied++;
    }
    console.log(`Successfully migrated ${productsCopied} products to 'products_test'.`);

    // 5. Migrate Inventory: 'inventory' -> 'inventory_test'
    console.log("\n2. Migrating Inventory...");
    const inventorySnap = await getDocs(collection(db, "inventory"));
    console.log(`Found ${inventorySnap.size} inventory documents in 'inventory'.`);
    
    let inventoryCopied = 0;
    for (const d of inventorySnap.docs) {
        const inventoryData = d.data();
        const targetDocRef = doc(db, "inventory_test", d.id);
        await setDoc(targetDocRef, inventoryData);
        inventoryCopied++;
    }
    console.log(`Successfully migrated ${inventoryCopied} inventory items to 'inventory_test'.`);

    console.log("\n=== Migration Completed Successfully! ===");
}

runMigration().catch(err => {
    console.error("\nMigration failed with error:", err.message);
    process.exit(1);
});
