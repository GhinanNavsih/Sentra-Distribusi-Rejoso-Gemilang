import { db, auth } from "../firebase.config";
import { doc, getDoc, setDoc, runTransaction, deleteDoc, serverTimestamp } from "firebase/firestore";
import { getCollectionName } from "../utils/envMode";

const getCurrentUserEmail = () => {
    return auth.currentUser?.email || auth.currentUser?.uid || "system";
};

export const inventoryService = {
    /**
     * Write a stock movement log inside an existing Firestore transaction
     */
    logMovementTx: (transaction, { product_id, transaction_id, transaction_type, change_qty, stock_before, stock_after, operator }) => {
        const col = getCollectionName("stock_movements");
        const logId = `LOG-${Date.now()}-${product_id}-${Math.floor(Math.random() * 10000)}`;
        const logRef = doc(db, col, logId);
        transaction.set(logRef, {
            id: logId,
            product_id,
            transaction_id,
            transaction_type,
            change_qty: Number(change_qty),
            stock_before: Number(stock_before),
            stock_after: Number(stock_after),
            operator: operator || getCurrentUserEmail(),
            created_at: serverTimestamp()
        });
    },

    /**
     * Write a stock movement log outside of a transaction (as a direct write)
     */
    logMovement: async ({ product_id, transaction_id, transaction_type, change_qty, stock_before, stock_after, operator }) => {
        const col = getCollectionName("stock_movements");
        const logId = `LOG-${Date.now()}-${product_id}-${Math.floor(Math.random() * 10000)}`;
        const logRef = doc(db, col, logId);
        await setDoc(logRef, {
            id: logId,
            product_id,
            transaction_id,
            transaction_type,
            change_qty: Number(change_qty),
            stock_before: Number(stock_before),
            stock_after: Number(stock_after),
            operator: operator || getCurrentUserEmail(),
            created_at: serverTimestamp()
        });
    },

    /**
     * Initialize or Update Stock for a product (Single Record Strategy for MVP)
     * Uses SKU as Document ID for the inventory record for simple aggregation.
     */
    updateStock: async (sku, changeInBaseUnits, transactionId = null, transactionType = 'stock_adjusted', operator = null) => {
        const col = getCollectionName("inventory");
        const inventoryRef = doc(db, col, sku);

        await runTransaction(db, async (transaction) => {
            const sfDoc = await transaction.get(inventoryRef);
            let beforeStock = 0;
            if (!sfDoc.exists()) {
                transaction.set(inventoryRef, { product_id: sku, current_stock_base: changeInBaseUnits });
            } else {
                beforeStock = sfDoc.data().current_stock_base || 0;
                const newStock = beforeStock + changeInBaseUnits;
                transaction.update(inventoryRef, { current_stock_base: newStock });
            }
            const afterStock = beforeStock + changeInBaseUnits;

            const actualTxId = transactionId || `ADJ-${new Date().toISOString().slice(0, 10)}-${Date.now()}-${sku}`;
            inventoryService.logMovementTx(transaction, {
                product_id: sku,
                transaction_id: actualTxId,
                transaction_type: transactionType,
                change_qty: changeInBaseUnits,
                stock_before: beforeStock,
                stock_after: afterStock,
                operator
            });
        });
    },

    /**
     * Explicitly set stock level
     */
    setStock: async (sku, newQuantity, transactionId = null, operator = null) => {
        const col = getCollectionName("inventory");
        const inventoryRef = doc(db, col, sku);

        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(inventoryRef);
            const beforeStock = docSnap.exists() ? (docSnap.data().current_stock_base || 0) : 0;
            const changeQty = Number(newQuantity) - beforeStock;

            transaction.set(inventoryRef, {
                product_id: sku,
                current_stock_base: Number(newQuantity)
            }, { merge: true });

            const actualTxId = transactionId || `ADJ-${new Date().toISOString().slice(0, 10)}-${Date.now()}-${sku}`;
            inventoryService.logMovementTx(transaction, {
                product_id: sku,
                transaction_id: actualTxId,
                transaction_type: 'stock_adjusted',
                change_qty: changeQty,
                stock_before: beforeStock,
                stock_after: Number(newQuantity),
                operator
            });
        });
    },

    /**
     * Delete stock record
     */
    deleteStock: async (sku, transactionId = null, operator = null) => {
        const col = getCollectionName("inventory");
        const inventoryRef = doc(db, col, sku);

        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(inventoryRef);
            const beforeStock = docSnap.exists() ? (docSnap.data().current_stock_base || 0) : 0;

            transaction.delete(inventoryRef);

            const actualTxId = transactionId || `DEL-${new Date().toISOString().slice(0, 10)}-${Date.now()}-${sku}`;
            inventoryService.logMovementTx(transaction, {
                product_id: sku,
                transaction_id: actualTxId,
                transaction_type: 'stock_deleted',
                change_qty: -beforeStock,
                stock_before: beforeStock,
                stock_after: 0,
                operator
            });
        });
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
    repack: async (fromSku, toSku, qtyToOpen, conversionRate, operator = null) => {
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
            const currentTo = toDoc.exists() ? (toDoc.data().current_stock_base || 0) : 0;
            const newTo = currentTo + addition;

            transaction.update(fromRef, { current_stock_base: newFrom });
            if (!toDoc.exists()) {
                transaction.set(toRef, { product_id: toSku, current_stock_base: newTo });
            } else {
                transaction.update(toRef, { current_stock_base: newTo });
            }

            const repackTxId = `REPACK-${new Date().toISOString().slice(0, 10)}-${Date.now()}`;

            // Log Source product deduction
            inventoryService.logMovementTx(transaction, {
                product_id: fromSku,
                transaction_id: repackTxId,
                transaction_type: 'repack_source',
                change_qty: -qtyToOpen,
                stock_before: currentFrom,
                stock_after: newFrom,
                operator
            });

            // Log Target product addition
            inventoryService.logMovementTx(transaction, {
                product_id: toSku,
                transaction_id: repackTxId,
                transaction_type: 'repack_target',
                change_qty: addition,
                stock_before: currentTo,
                stock_after: newTo,
                operator
            });
        });
    }
};
