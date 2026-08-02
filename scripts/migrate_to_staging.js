import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(scriptDirectory, '../.env');
if (!fs.existsSync(envPath)) {
    console.error('Error: .env file not found at the project root.');
    process.exit(1);
}

const env = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const separator = line.indexOf('=');
    if (separator > 0) env[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
});

const projectId = env.VITE_FIREBASE_PROJECT_ID;
if (!projectId) {
    console.error('Error: VITE_FIREBASE_PROJECT_ID is missing from .env.');
    process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
const collectionsToCopy = [
    'products',
    'inventory',
    'orders',
    'purchases',
    'counters',
    'stock_losses',
    'stock_movements',
    'inventory_operations'
];

const askQuestion = (question) => {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => prompt.question(question, answer => {
        prompt.close();
        resolve(answer.trim());
    }));
};

async function copyCollection(sourceName) {
    const snapshot = await db.collection(sourceName).get();
    const writer = db.bulkWriter();
    snapshot.docs.forEach(document => {
        writer.set(db.collection(`${sourceName}_test`).doc(document.id), document.data());
    });
    await writer.close();
    return snapshot.size;
}

async function runMigration() {
    console.log('=== Firebase Data Migration (Production -> Staging) ===');
    console.log(`Project: ${projectId}`);
    console.log('This copies operational history into *_test collections and does not delete production data.');
    const confirmation = await askQuestion(`Type ${projectId} to continue: `);
    if (confirmation !== projectId) {
        console.log('Migration cancelled.');
        return;
    }

    for (const collectionName of collectionsToCopy) {
        const copied = await copyCollection(collectionName);
        console.log(`${collectionName} -> ${collectionName}_test: ${copied} documents copied.`);
    }
    console.log('=== Migration Completed Successfully ===');
}

runMigration().catch(error => {
    console.error('Migration failed:', error.message);
    process.exit(1);
});
