import { db } from "../firebase.config";
import { doc, getDoc, setDoc, runTransaction, deleteDoc } from "firebase/firestore";
import { getCollectionName } from "../utils/envMode";

export const inventoryService = {
    /**
     * Initialize or Update Stock for a product (Single Record Strategy for MVP)
     * Uses SKU as Document ID for the inventory record for simple aggregation.
     */
    updateStock: async (sku, changeInBaseUnits) => {
        const col = getCollectionName("inventory");
        const inventoryRef = doc(db, col, sku);

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
        const col = getCollectionName("inventory");
        const inventoryRef = doc(db, col, sku);
        await setDoc(inventoryRef, {
            product_id: sku,
            current_stock_base: Number(newQuantity)
        }, { merge: true });
    },

    /**
     * Delete stock record
     */
    deleteStock: async (sku) => {
        const col = getCollectionName("inventory");
        const inventoryRef = doc(db, col, sku);
        await deleteDoc(inventoryRef);
    },

    /**
     * Get stock level for a product
     */
    getStock: async (sku) => {
        const col = getCollectionName("inventory");
        const docRef = doc(db, col, sku);
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
        const col = getCollectionName("inventory");
        const addition = qtyToOpen * conversionRate;

        // Execute as transaction
        await runTransaction(db, async (transaction) => {
            const fromRef = doc(db, col, fromSku);
            const toRef = doc(db, col, toSku);

            const fromDoc = await transaction.get(fromRef);
            const toDoc = await transaction.get(toRef);

            if (!fromDoc.exists()) {
                throw new Error(`Produk sumber ${fromSku} tidak ditemukan di inventori.`);
            }

            const currentFrom = fromDoc.data().current_stock_base || 0;
            if (currentFrom < qtyToOpen) {
                throw new Error(`Stok tidak cukup untuk ${fromSku}. Saat ini: ${currentFrom}`);
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
