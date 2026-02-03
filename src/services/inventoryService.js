import { db } from "../firebase.config";
import { collection, doc, getDoc, setDoc, runTransaction, writeBatch, deleteDoc } from "firebase/firestore";

const COLLECTION_NAME = "inventory";

export const inventoryService = {
    /**
     * Initialize or Update Stock for a product (Single Record Strategy for MVP)
     * Uses SKU as Document ID for the inventory record for simple aggregation.
     */
    updateStock: async (sku, changeInBaseUnits) => {
        const inventoryRef = doc(db, COLLECTION_NAME, sku);

        await runTransaction(db, async (transaction) => {
            const sfDoc = await transaction.get(inventoryRef);
            if (!sfDoc.exists()) {
                transaction.set(inventoryRef, { product_id: sku, current_stock_base: changeInBaseUnits });
            } else {
                const newStock = (sfDoc.data().current_stock_base || 0) + changeInBaseUnits;
                transaction.update(inventoryRef, { current_stock_base: newStock });
            }
        });
    },

    /**
     * Explicitly set stock level
     */
    setStock: async (sku, newQuantity) => {
        const inventoryRef = doc(db, COLLECTION_NAME, sku);
        await setDoc(inventoryRef, {
            product_id: sku,
            current_stock_base: Number(newQuantity)
        }, { merge: true });
    },

    /**
     * Delete stock record
     */
    deleteStock: async (sku) => {
        const inventoryRef = doc(db, COLLECTION_NAME, sku);
        await deleteDoc(inventoryRef);
    },

    /**
     * Get stock level for a product
     */
    getStock: async (sku) => {
        const docRef = doc(db, COLLECTION_NAME, sku);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            return docSnap.data().current_stock_base;
        }
        return 0;
    },

    /**
     * Repack / Break Bulk
     * Deducts from Bulk Product -> Adds to Loose Product
     * @param {string} fromSku - The bulk product (e.g., Sugar (Sack))
     * @param {string} toSku - The loose product (e.g., Sugar (Kg))
     * @param {number} qtyToOpen - Number of bulk units to open (e.g., 1 Sack)
     * @param {number} conversionRate - How many loose units in 1 bulk unit (e.g., 50)
     */
    repack: async (fromSku, toSku, qtyToOpen, conversionRate) => {
        // 1. Deduct 'qtyToOpen' (which is 1 base unit of FromSku)
        // FromSku Base Unit = Sack. So we deduct 1.
        // 2. Add 'qtyToOpen * conversionRate' to ToSku.

        const deduction = -1 * qtyToOpen;
        const addition = qtyToOpen * conversionRate;

        // Execute as transaction
        await runTransaction(db, async (transaction) => {
            const fromRef = doc(db, COLLECTION_NAME, fromSku);
            const toRef = doc(db, COLLECTION_NAME, toSku);

            const fromDoc = await transaction.get(fromRef);
            const toDoc = await transaction.get(toRef);

            if (!fromDoc.exists()) {
                throw new Error(`Source product ${fromSku} not found in inventory.`);
            }

            const currentFrom = fromDoc.data().current_stock_base || 0;
            if (currentFrom < qtyToOpen) {
                throw new Error(`Insufficient stock for ${fromSku}. Current: ${currentFrom}`);
            }

            const newFrom = currentFrom - qtyToOpen;
            const newTo = (toDoc.exists() ? toDoc.data().current_stock_base : 0) + addition;

            transaction.update(fromRef, { current_stock_base: newFrom });
            if (!toDoc.exists()) {
                transaction.set(toRef, { product_id: toSku, current_stock_base: newTo });
            } else {
                transaction.update(toRef, { current_stock_base: newTo });
            }
        });
    }
};
