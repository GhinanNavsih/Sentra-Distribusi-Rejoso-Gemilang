import { db } from "../firebase.config";
import { collection, doc, serverTimestamp, setDoc, getDocs, query, orderBy, runTransaction } from "firebase/firestore";
import { getCollectionName } from "../utils/envMode";
import { inventoryService } from "./inventoryService";

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
    updatePurchase: async (purchaseId, updatedItems, editorEmail) => {
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
                    const oldUnit = originalItem.unit;
                    const newUnit = updatedItem.unit || oldUnit;
                    
                    if (oldQty !== newQty || oldUnit !== newUnit) {
                        const invRef = doc(db, INVENTORY_COLLECTION, updatedItem.product_id);
                        const invDoc = await transaction.get(invRef);
                        inventoryReads.push({ updatedItem, originalItem, invRef, invDoc });
                    }
                }
                
                // PHASE 2: WRITE ALL MODIFICATIONS
                for (const { updatedItem, originalItem, invRef, invDoc } of inventoryReads) {
                    const oldQty = originalItem.qty;
                    const newQty = Number(updatedItem.qty);
                    
                    const baseUnitLower = (originalItem.base_unit || "").toLowerCase().trim();
                    const bulkUnitLower = (originalItem.bulk_unit_name || "").toLowerCase().trim();
                    const isSameUnit = baseUnitLower && bulkUnitLower && baseUnitLower === bulkUnitLower;
                    const conversion = isSameUnit ? 1 : (originalItem.bulk_unit_conversion || 1);

                    const oldIsBulk = originalItem.unit === originalItem.bulk_unit_name;
                    const oldMultiplier = oldIsBulk ? conversion : 1;

                    const newUnit = updatedItem.unit || originalItem.unit;
                    const newIsBulk = newUnit === originalItem.bulk_unit_name;
                    const newMultiplier = newIsBulk ? conversion : 1;

                    // Change = (newQty * newMultiplier) - (oldQty * oldMultiplier)
                    const changeInBaseUnits = (newQty * newMultiplier) - (oldQty * oldMultiplier);
                    
                    let beforeStock = 0;
                    if (invDoc.exists()) {
                        beforeStock = invDoc.data().current_stock_base || 0;
                        const newStock = beforeStock + changeInBaseUnits;
                        transaction.update(invRef, {
                            current_stock_base: newStock
                        });
                    } else {
                        const newStock = changeInBaseUnits;
                        transaction.set(invRef, {
                            product_id: updatedItem.product_id,
                            current_stock_base: newStock
                        });
                    }
                    const afterStock = beforeStock + changeInBaseUnits;

                    // Log stock movement inside transaction
                    inventoryService.logMovementTx(transaction, {
                        product_id: updatedItem.product_id,
                        transaction_id: purchaseId,
                        transaction_type: 'purchase_updated',
                        change_qty: changeInBaseUnits,
                        stock_before: beforeStock,
                        stock_after: afterStock,
                        operator: editorEmail || null
                    });
                }
                
                const newItems = originalItems.map(origItem => {
                    const updated = updatedItems.find(u => u.product_id === origItem.product_id);
                    if (updated) {
                        const newQty = Number(updated.qty);
                        const newUnit = updated.unit || origItem.unit;
                        const newCostPerUnit = updated.cost_per_unit !== undefined ? Number(updated.cost_per_unit) : origItem.cost_per_unit;
                        return {
                            ...origItem,
                            qty: newQty,
                            unit: newUnit,
                            cost_per_unit: newCostPerUnit,
                            total: newQty * newCostPerUnit
                        };
                    }
                    return origItem;
                });
                
                const newGrandTotal = newItems.reduce((sum, item) => sum + (item.total || 0), 0);
                
                // Track edit history
                const existingLogs = originalPurchase.change_logs || [];
                const newLog = {
                    edited_at: new Date().toISOString(),
                    edited_by: editorEmail || 'Unknown',
                    previous_items: originalItems,
                    new_items: newItems
                };
                const updatedLogs = [...existingLogs, newLog];

                transaction.update(purchaseRef, {
                    items: newItems,
                    grand_total: newGrandTotal,
                    change_logs: updatedLogs
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
    },

    /**
     * Cancel/undo an existing purchase and deduct stock from inventory
     * @param {string} purchaseId
     */
    cancelPurchase: async (purchaseId, operatorEmail = null) => {
        const COLLECTION_NAME = getCollectionName("purchases");
        const INVENTORY_COLLECTION = getCollectionName("inventory");
        const PRODUCTS_COLLECTION = getCollectionName("products");
        
        try {
            await runTransaction(db, async (transaction) => {
                const purchaseRef = doc(db, COLLECTION_NAME, purchaseId);
                const purchaseDoc = await transaction.get(purchaseRef);
                if (!purchaseDoc.exists()) {
                    throw new Error("Purchase tidak ditemukan");
                }
                
                const purchaseData = purchaseDoc.data();
                if (purchaseData.status === 'cancelled') {
                    throw new Error("Purchase sudah dibatalkan");
                }
                
                const items = purchaseData.items || [];
                
                // PHASE 1: READ ALL PRODUCTS AND INVENTORY DOCS FIRST
                const productReads = [];
                for (const item of items) {
                    const prodRef = doc(db, PRODUCTS_COLLECTION, item.product_id);
                    const prodDoc = await transaction.get(prodRef);
                    productReads.push({ item, prodDoc });
                }
                
                const inventoryReads = [];
                for (const item of items) {
                    const invRef = doc(db, INVENTORY_COLLECTION, item.product_id);
                    const invDoc = await transaction.get(invRef);
                    inventoryReads.push({ item, invRef, invDoc });
                }
                
                // PHASE 2: DEDUCT STOCK
                for (let i = 0; i < items.length; i++) {
                    const { item, invRef, invDoc } = inventoryReads[i];
                    const { prodDoc } = productReads[i];
                    
                    let multiplier = 1;
                    if (prodDoc.exists()) {
                        const prodData = prodDoc.data();
                        if (prodData.bulk_unit_name && item.unit === prodData.bulk_unit_name) {
                            const baseUnitLower = (prodData.base_unit || "").toLowerCase().trim();
                            const bulkUnitLower = (prodData.bulk_unit_name || "").toLowerCase().trim();
                            const isSameUnit = baseUnitLower && bulkUnitLower && baseUnitLower === bulkUnitLower;
                            multiplier = isSameUnit ? 1 : (prodData.bulk_unit_conversion || 1);
                        }
                    }
                    
                    const deductQty = Number(item.qty) * multiplier;
                    
                    let beforeStock = 0;
                    if (invDoc.exists()) {
                        beforeStock = invDoc.data().current_stock_base || 0;
                        const newStock = beforeStock - deductQty;
                        transaction.update(invRef, {
                            current_stock_base: newStock
                        });
                    } else {
                        const newStock = -deductQty;
                        transaction.set(invRef, {
                            product_id: item.product_id,
                            current_stock_base: newStock
                        });
                    }
                    const afterStock = beforeStock - deductQty;

                    // Log stock movement inside transaction
                    inventoryService.logMovementTx(transaction, {
                        product_id: item.product_id,
                        transaction_id: purchaseId,
                        transaction_type: 'purchase_cancelled',
                        change_qty: -deductQty,
                        stock_before: beforeStock,
                        stock_after: afterStock,
                        operator: operatorEmail || null
                    });
                }
                
                // Update Purchase Status to 'cancelled'
                transaction.update(purchaseRef, {
                    status: 'cancelled',
                    cancelled_at: new Date().toISOString()
                });
            });
        } catch (error) {
            console.error("Failed to cancel purchase:", error);
            throw error;
        }
    }
};
