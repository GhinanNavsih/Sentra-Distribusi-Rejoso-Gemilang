import { db } from "../firebase.config";
import { collection, doc, serverTimestamp, setDoc, getDocs, query, orderBy, runTransaction } from "firebase/firestore";
import { getCollectionName } from "../utils/envMode";

// Helper to get today's date string YYYY-MM-DD
const getTodayDateString = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

export const purchaseService = {
    /**
     * Create a new purchase record
     * @param {Object} purchaseData - { items, grand_total, supplier_name, receipt_file }
     */
    createPurchase: async (purchaseData) => {
        const COLLECTION_NAME = getCollectionName("purchases");
        const COUNTER_COLLECTION = getCollectionName("counters");
        try {
            // Generate unique purchase ID
            const dateStr = getTodayDateString();
            const counterRef = doc(db, COUNTER_COLLECTION, `purchases_${dateStr}`);

            // Get current count
            const counterSnap = await getDocs(query(collection(db, COUNTER_COLLECTION)));
            let nextCount = 1;

            const existingCounter = counterSnap.docs.find(d => d.id === `purchases_${dateStr}`);
            if (existingCounter) {
                nextCount = existingCounter.data().count + 1;
            }

            // Format: PUR-2026-02-07-0001
            const countStr = String(nextCount).padStart(4, '0');
            const newPurchaseId = `PUR-${dateStr}-${countStr}`;

            // Create purchase record
            const purchaseRef = doc(db, COLLECTION_NAME, newPurchaseId);
            await setDoc(purchaseRef, {
                ...purchaseData,
                id: newPurchaseId,
                created_at: serverTimestamp()
            });

            // Update counter
            await setDoc(counterRef, { count: nextCount }, { merge: true });

            return newPurchaseId;
        } catch (error) {
            console.error("Error creating purchase:", error);
            throw error;
        }
    },

    /**
     * Update an existing purchase and adjust inventory accordingly
     * @param {string} purchaseId
     * @param {Array} updatedItems - [{ product_id, qty, multiplier }]
     */
    updatePurchase: async (purchaseId, updatedItems) => {
        const COLLECTION_NAME = getCollectionName("purchases");
        const INVENTORY_COLLECTION = getCollectionName("inventory");
        
        try {
            await runTransaction(db, async (transaction) => {
                const purchaseRef = doc(db, COLLECTION_NAME, purchaseId);
                const purchaseDoc = await transaction.get(purchaseRef);
                if (!purchaseDoc.exists()) {
                    throw new Error("Purchase tidak ditemukan");
                }
                
                const originalPurchase = purchaseDoc.data();
                const originalItems = originalPurchase.items || [];
                
                const originalItemsMap = {};
                originalItems.forEach(item => {
                    originalItemsMap[item.product_id] = item;
                });

                // PHASE 1: READ ALL INVENTORY DOCS FIRST
                const inventoryReads = [];
                for (const updatedItem of updatedItems) {
                    const originalItem = originalItemsMap[updatedItem.product_id];
                    if (!originalItem) continue;
                    
                    const oldQty = originalItem.qty;
                    const newQty = Number(updatedItem.qty);
                    
                    if (oldQty !== newQty) {
                        const invRef = doc(db, INVENTORY_COLLECTION, updatedItem.product_id);
                        const invDoc = await transaction.get(invRef);
                        inventoryReads.push({ updatedItem, originalItem, invRef, invDoc });
                    }
                }
                
                // PHASE 2: WRITE ALL MODIFICATIONS
                for (const { updatedItem, originalItem, invRef, invDoc } of inventoryReads) {
                    const oldQty = originalItem.qty;
                    const newQty = Number(updatedItem.qty);
                    const multiplier = Number(updatedItem.multiplier || 1);
                    
                    // Change = (newQty - oldQty) * multiplier
                    const changeInBaseUnits = (newQty - oldQty) * multiplier;
                    
                    if (invDoc.exists()) {
                        const currentStock = invDoc.data().current_stock_base || 0;
                        transaction.update(invRef, {
                            current_stock_base: currentStock + changeInBaseUnits
                        });
                    } else {
                        transaction.set(invRef, {
                            product_id: updatedItem.product_id,
                            current_stock_base: changeInBaseUnits
                        });
                    }
                }
                
                const newItems = originalItems.map(origItem => {
                    const updated = updatedItems.find(u => u.product_id === origItem.product_id);
                    if (updated) {
                        const newQty = Number(updated.qty);
                        return {
                            ...origItem,
                            qty: newQty,
                            total: newQty * (origItem.cost_per_unit || 0)
                        };
                    }
                    return origItem;
                });
                
                const newGrandTotal = newItems.reduce((sum, item) => sum + (item.total || 0), 0);
                
                transaction.update(purchaseRef, {
                    items: newItems,
                    grand_total: newGrandTotal
                });
            });
        } catch (error) {
            console.error("Failed to update purchase:", error);
            throw error;
        }
    },

    /**
     * Get all purchases
     */
    getAllPurchases: async () => {
        const COLLECTION_NAME = getCollectionName("purchases");
        try {
            const q = query(collection(db, COLLECTION_NAME), orderBy("created_at", "desc"));
            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error("Error fetching purchases:", error);
            throw error;
        }
    }
};
