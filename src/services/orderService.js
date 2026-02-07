import { db } from "../firebase.config";
import { collection, doc, serverTimestamp, runTransaction } from "firebase/firestore";
import { getCollectionName } from "../utils/envMode";

// Helper to get today's date string YYYY-MM-DD
const getTodayDateString = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

export const orderService = {
    /**
     * Create a new order and deduct inventory
     * @param {Object} orderData - { items: [{ product_id, qty, unit_price, total, product_name }], grand_total }
     */
    createOrder: async (orderData) => {
        const COLLECTION_NAME = getCollectionName("orders");
        const INVENTORY_COLLECTION = getCollectionName("inventory");
        const COUNTER_COLLECTION = getCollectionName("counters");
        // We need to run this as a transaction to ensure stock is available and deducted correctly
        // AND to safely increment the daily order ID counter
        try {
            await runTransaction(db, async (transaction) => {
                // --- PHASE 1: ALL READS FIRST ---

                // Read 1: Generate ID
                const dateStr = getTodayDateString(); // e.g., "2026-02-07"
                const counterRef = doc(db, COUNTER_COLLECTION, `orders_${dateStr}`);
                const counterDoc = await transaction.get(counterRef);

                let nextCount = 1;
                if (counterDoc.exists()) {
                    nextCount = counterDoc.data().count + 1;
                }

                // Format: 2026-02-07-0001
                const countStr = String(nextCount).padStart(4, '0');
                const newOrderId = `${dateStr}-${countStr}`;

                // Read 2: Check stock for all items (READ ALL FIRST)
                const inventoryReads = [];
                for (const item of orderData.items) {
                    const invRef = doc(db, INVENTORY_COLLECTION, item.product_id);
                    const invDoc = await transaction.get(invRef);
                    inventoryReads.push({ item, invRef, invDoc });
                }

                // Validate stock availability
                for (const { item, invDoc } of inventoryReads) {
                    if (!invDoc.exists()) {
                        throw new Error(`Produk ${item.product_name} tidak ditemukan di inventori.`);
                    }

                    const currentStock = invDoc.data().current_stock_base || 0;
                    if (currentStock < item.qty) {
                        throw new Error(`Stok tidak cukup untuk ${item.product_name}. Diminta: ${item.qty}, Tersedia: ${currentStock}`);
                    }
                }

                // --- PHASE 2: ALL WRITES AFTER READS ---

                // Write 1: Deduct inventory
                for (const { item, invRef, invDoc } of inventoryReads) {
                    const currentStock = invDoc.data().current_stock_base || 0;
                    transaction.update(invRef, {
                        current_stock_base: currentStock - item.qty
                    });
                }

                // Write 2: Update Counter
                transaction.set(counterRef, { count: nextCount }, { merge: true });

                // Write 3: Create Order Record with Custom ID
                const orderRef = doc(db, COLLECTION_NAME, newOrderId);
                transaction.set(orderRef, {
                    ...orderData,
                    id: newOrderId, // Explicitly save ID in data too
                    status: 'completed',
                    created_at: serverTimestamp()
                });
            });

            return true;
        } catch (e) {
            console.error("Order Transaction Failed", e);
            throw e;
        }
    },

    /**
     * Create an order record WITHOUT deducting inventory.
     * Used for stock adjustments where inventory is set separately.
     */
    createOrderRecord: async (orderData) => {
        const COLLECTION_NAME = getCollectionName("orders");
        const COUNTER_COLLECTION = getCollectionName("counters");
        try {
            await runTransaction(db, async (transaction) => {
                const dateStr = getTodayDateString();
                const counterRef = doc(db, COUNTER_COLLECTION, `orders_${dateStr}`);
                const counterDoc = await transaction.get(counterRef);

                let nextCount = 1;
                if (counterDoc.exists()) {
                    nextCount = counterDoc.data().count + 1;
                }

                const countStr = String(nextCount).padStart(4, '0');
                const newOrderId = `${dateStr}-${countStr}`;

                transaction.set(counterRef, { count: nextCount }, { merge: true });

                const orderRef = doc(db, COLLECTION_NAME, newOrderId);
                transaction.set(orderRef, {
                    ...orderData,
                    id: newOrderId,
                    status: 'completed',
                    created_at: serverTimestamp()
                });
            });
            return true;
        } catch (e) {
            console.error("Order Record Creation Failed", e);
            throw e;
        }
    },

    /**
     * Get all orders
     */
    getAllOrders: async () => {
        const COLLECTION_NAME = getCollectionName("orders");
        try {
            const { getDocs, query, orderBy } = await import('firebase/firestore');
            const q = query(collection(db, COLLECTION_NAME), orderBy("created_at", "desc"));
            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error("Error fetching orders:", error);
            throw error;
        }
    }
};
