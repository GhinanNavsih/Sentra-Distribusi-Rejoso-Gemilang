import { db } from "../firebase.config";
import { collection, doc, serverTimestamp, runTransaction } from "firebase/firestore";
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

const getBaseQuantity = (item) => {
    const qty = Number(item.qty) || 0;
    if (item.selected_unit !== 'bulk') return qty;

    const baseUnitLower = (item.base_unit || "").toLowerCase().trim();
    const bulkUnitLower = (item.bulk_unit_name || "").toLowerCase().trim();
    const isSameUnit = baseUnitLower && bulkUnitLower && baseUnitLower === bulkUnitLower;
    const conversion = isSameUnit ? 1 : (Number(item.bulk_unit_conversion) || 1);
    return qty * conversion;
};

const cleanOrderItems = (items = []) => items.map(item => {
    const { _deductionQty, product_obj, ...cleanItem } = item;

    if (cleanItem.buy_price === undefined && product_obj) {
        cleanItem.buy_price = product_obj.cost_price || 0;
    }

    return cleanItem;
});

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
        let newOrderId;
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
                newOrderId = `${dateStr}-${countStr}`;

                // Read 2: Check stock for all items (READ ALL FIRST)
                const inventoryReads = [];
                for (const item of orderData.items) {
                    const invRef = doc(db, INVENTORY_COLLECTION, item.product_id);
                    const invDoc = await transaction.get(invRef);
                    inventoryReads.push({ item, invRef, invDoc });
                }

                // Validate stock availability
                const insufficientItems = [];
                for (const { item, invDoc } of inventoryReads) {
                    if (!invDoc.exists()) {
                        throw new Error(`Produk ${item.product_name} tidak ditemukan di inventori.`);
                    }

                    // Calculate deduction amount based on unit
                    let deductionQty = item.qty;
                    if (item.selected_unit === 'bulk') {
                        const baseUnitLower = (item.base_unit || "").toLowerCase().trim();
                        const bulkUnitLower = (item.bulk_unit_name || "").toLowerCase().trim();
                        const isSameUnit = baseUnitLower && bulkUnitLower && baseUnitLower === bulkUnitLower;
                        const conversion = isSameUnit ? 1 : (item.bulk_unit_conversion || 1);
                        deductionQty = item.qty * conversion;
                    }

                    const currentStock = invDoc.data().current_stock_base || 0;
                    if (currentStock < deductionQty) {
                        insufficientItems.push({
                            product_id: item.product_id,
                            product_name: item.product_name,
                            base_unit: item.base_unit,
                            qty: item.qty,
                            selected_unit: item.selected_unit || 'base',
                            bulk_unit_name: item.bulk_unit_name,
                            bulk_unit_conversion: item.bulk_unit_conversion,
                            demanded_base: deductionQty,
                            available_base: currentStock,
                            delta_base: deductionQty - currentStock
                        });
                    }

                    // Store deduction qty for next step
                    item._deductionQty = deductionQty;
                }

                if (insufficientItems.length > 0) {
                    const err = new Error("Stok tidak mencukupi");
                    err.name = "InsufficientStockError";
                    err.details = insufficientItems;
                    throw err;
                }

                // --- PHASE 2: ALL WRITES AFTER READS ---

                // Write 1: Deduct inventory
                for (const { item, invRef, invDoc } of inventoryReads) {
                    const currentStock = invDoc.data().current_stock_base || 0;
                    const changeQty = -item._deductionQty;
                    const newStock = currentStock + changeQty;
                    transaction.update(invRef, {
                        current_stock_base: newStock
                    });

                    // Log stock movement inside transaction
                    inventoryService.logMovementTx(transaction, {
                        product_id: item.product_id,
                        transaction_id: newOrderId,
                        transaction_type: 'sale_created',
                        change_qty: changeQty,
                        stock_before: currentStock,
                        stock_after: newStock,
                        operator: orderData.created_by || null
                    });
                }

                // Write 2: Update Counter
                transaction.set(counterRef, { count: nextCount }, { merge: true });

                // Write 3: Create Order Record with Custom ID
                const orderRef = doc(db, COLLECTION_NAME, newOrderId);

                // Clean items (remove temporary props like _deductionQty)
                const itemsToSave = orderData.items.map(item => {
                    const { _deductionQty, product_obj, ...cleanItem } = item;

                    // Capture buy_price at the moment of sale for profit calculation
                    // If buy_price is already passed, use it; otherwise try to get from product_obj if available
                    if (cleanItem.buy_price === undefined && product_obj) {
                        cleanItem.buy_price = product_obj.cost_price || 0;
                    }

                    return cleanItem;
                });

                transaction.set(orderRef, {
                    ...orderData,
                    items: itemsToSave,
                    id: newOrderId, // Explicitly save ID in data too
                    payment_status: 'paid',
                    status: 'completed',
                    created_at: serverTimestamp()
                });
            });

            return newOrderId;
        } catch (e) {
            console.error("Order Transaction Failed", e);
            throw e;
        }
    },

    /**
     * Create an unpaid pre-order without changing on-hand inventory.
     */
    createUnpaidOrder: async (orderData) => {
        const COLLECTION_NAME = getCollectionName("orders");
        const COUNTER_COLLECTION = getCollectionName("counters");
        const targetDate = orderData.target_date;

        if (!targetDate || targetDate < getTodayDateString()) {
            throw new Error("Tanggal target pre-order harus hari ini atau setelahnya.");
        }

        let newOrderId;
        try {
            await runTransaction(db, async (transaction) => {
                const dateStr = getTodayDateString();
                const counterRef = doc(db, COUNTER_COLLECTION, `orders_${dateStr}`);
                const counterDoc = await transaction.get(counterRef);
                const nextCount = counterDoc.exists() ? counterDoc.data().count + 1 : 1;

                newOrderId = `${dateStr}-${String(nextCount).padStart(4, '0')}`;

                transaction.set(counterRef, { count: nextCount }, { merge: true });
                transaction.set(doc(db, COLLECTION_NAME, newOrderId), {
                    ...orderData,
                    items: cleanOrderItems(orderData.items),
                    customer_name: (orderData.customer_name || "").trim(),
                    target_date: targetDate,
                    id: newOrderId,
                    payment_status: 'unpaid',
                    status: 'unpaid',
                    created_at: serverTimestamp()
                });
            });

            return newOrderId;
        } catch (e) {
            console.error("Unpaid Order Creation Failed", e);
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
        let newOrderId;
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
                newOrderId = `${dateStr}-${countStr}`;

                transaction.set(counterRef, { count: nextCount }, { merge: true });

                const orderRef = doc(db, COLLECTION_NAME, newOrderId);
                transaction.set(orderRef, {
                    ...orderData,
                    id: newOrderId,
                    payment_status: orderData.payment_status || 'paid',
                    status: 'completed',
                    created_at: serverTimestamp()
                });
            });
            return newOrderId;
        } catch (e) {
            console.error("Order Record Creation Failed", e);
            throw e;
        }
    },
    /**
     * Update an existing order and adjust inventory accordingly
     * @param {string} orderId
     * @param {Array} updatedItems - [{ product_id, qty }]
     */
    updateOrder: async (orderId, updatedItems, editorEmail) => {
        const COLLECTION_NAME = getCollectionName("orders");
        const INVENTORY_COLLECTION = getCollectionName("inventory");
        
        try {
            await runTransaction(db, async (transaction) => {
                const orderRef = doc(db, COLLECTION_NAME, orderId);
                const orderDoc = await transaction.get(orderRef);
                if (!orderDoc.exists()) {
                    throw new Error("Order tidak ditemukan");
                }
                
                const originalOrder = orderDoc.data();
                const originalItems = originalOrder.items || [];
                const shouldAdjustInventory = originalOrder.payment_status !== 'unpaid'
                    && originalOrder.status !== 'unpaid';
                
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
                    const oldUnit = originalItem.selected_unit;
                    const newUnit = updatedItem.selected_unit || oldUnit;
                    
                    if (shouldAdjustInventory && (oldQty !== newQty || oldUnit !== newUnit)) {
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

                    const oldIsBulk = originalItem.selected_unit === 'bulk';
                    const oldMultiplier = oldIsBulk ? conversion : 1;

                    const newUnit = updatedItem.selected_unit || originalItem.selected_unit;
                    const newIsBulk = newUnit === 'bulk';
                    const newMultiplier = newIsBulk ? conversion : 1;

                    // Change = (oldQty * oldMultiplier) - (newQty * newMultiplier)
                    const changeInBaseUnits = (oldQty * oldMultiplier) - (newQty * newMultiplier);
                    
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
                        transaction_id: orderId,
                        transaction_type: 'sale_updated',
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
                        const newUnit = updated.selected_unit || origItem.selected_unit;
                        const newUnitPrice = updated.unit_price !== undefined ? Number(updated.unit_price) : origItem.unit_price;
                        const newBuyPrice = updated.buy_price !== undefined ? Number(updated.buy_price) : origItem.buy_price;

                        return {
                            ...origItem,
                            qty: newQty,
                            selected_unit: newUnit,
                            unit_price: newUnitPrice,
                            buy_price: newBuyPrice,
                            total: newQty * newUnitPrice
                        };
                    }
                    return origItem;
                });
                
                const newGrandTotal = newItems.reduce((sum, item) => sum + (item.total || 0), 0);
                
                // Track edit history
                const existingLogs = originalOrder.change_logs || [];
                const newLog = {
                    edited_at: new Date().toISOString(),
                    edited_by: editorEmail || 'Unknown',
                    previous_items: originalItems,
                    new_items: newItems
                };
                const updatedLogs = [...existingLogs, newLog];

                transaction.update(orderRef, {
                    items: newItems,
                    grand_total: newGrandTotal,
                    change_logs: updatedLogs
                });
            });
        } catch (error) {
            console.error("Failed to update order:", error);
            throw error;
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
    },

    /**
     * Convert an unpaid pre-order to a paid sale and deduct inventory atomically.
     */
    payUnpaidOrder: async (orderId, operatorEmail = null) => {
        const COLLECTION_NAME = getCollectionName("orders");
        const INVENTORY_COLLECTION = getCollectionName("inventory");

        try {
            await runTransaction(db, async (transaction) => {
                const orderRef = doc(db, COLLECTION_NAME, orderId);
                const orderDoc = await transaction.get(orderRef);

                if (!orderDoc.exists()) {
                    throw new Error("Pre-order tidak ditemukan.");
                }

                const orderData = orderDoc.data();
                if (orderData.status === 'cancelled') {
                    throw new Error("Pre-order sudah dibatalkan.");
                }
                if (orderData.payment_status !== 'unpaid' && orderData.status !== 'unpaid') {
                    throw new Error("Transaksi ini sudah lunas.");
                }

                const inventoryReads = [];
                for (const item of orderData.items || []) {
                    const invRef = doc(db, INVENTORY_COLLECTION, item.product_id);
                    const invDoc = await transaction.get(invRef);
                    inventoryReads.push({
                        item,
                        invRef,
                        invDoc,
                        deductionQty: getBaseQuantity(item)
                    });
                }

                const insufficientItems = inventoryReads
                    .filter(({ invDoc, deductionQty }) => {
                        const currentStock = invDoc.exists()
                            ? (Number(invDoc.data().current_stock_base) || 0)
                            : 0;
                        return currentStock < deductionQty;
                    })
                    .map(({ item, invDoc, deductionQty }) => {
                        const currentStock = invDoc.exists()
                            ? (Number(invDoc.data().current_stock_base) || 0)
                            : 0;
                        return {
                            product_id: item.product_id,
                            product_name: item.product_name,
                            base_unit: item.base_unit,
                            qty: item.qty,
                            selected_unit: item.selected_unit || 'base',
                            bulk_unit_name: item.bulk_unit_name,
                            bulk_unit_conversion: item.bulk_unit_conversion,
                            demanded_base: deductionQty,
                            available_base: currentStock,
                            delta_base: deductionQty - currentStock
                        };
                    });

                if (insufficientItems.length > 0) {
                    const err = new Error("Stok tidak mencukupi untuk melunasi pre-order.");
                    err.name = "InsufficientStockError";
                    err.details = insufficientItems;
                    throw err;
                }

                for (const { item, invRef, invDoc, deductionQty } of inventoryReads) {
                    const currentStock = Number(invDoc.data().current_stock_base) || 0;
                    const newStock = currentStock - deductionQty;

                    transaction.update(invRef, { current_stock_base: newStock });
                    inventoryService.logMovementTx(transaction, {
                        product_id: item.product_id,
                        transaction_id: orderId,
                        transaction_type: 'sale_paid',
                        change_qty: -deductionQty,
                        stock_before: currentStock,
                        stock_after: newStock,
                        operator: operatorEmail || null
                    });
                }

                transaction.update(orderRef, {
                    payment_status: 'paid',
                    status: 'completed',
                    paid_at: serverTimestamp(),
                    paid_by: operatorEmail || null
                });
            });
        } catch (error) {
            console.error("Failed to pay unpaid order:", error);
            throw error;
        }
    },

    /**
     * Cancel/undo an existing order and restore inventory stock
     * @param {string} orderId
     */
    cancelOrder: async (orderId, operatorEmail = null) => {
        const COLLECTION_NAME = getCollectionName("orders");
        const INVENTORY_COLLECTION = getCollectionName("inventory");
        
        try {
            await runTransaction(db, async (transaction) => {
                const orderRef = doc(db, COLLECTION_NAME, orderId);
                const orderDoc = await transaction.get(orderRef);
                if (!orderDoc.exists()) {
                    throw new Error("Order tidak ditemukan");
                }
                
                const orderData = orderDoc.data();
                if (orderData.status === 'cancelled') {
                    throw new Error("Order sudah dibatalkan");
                }
                
                const items = orderData.items || [];
                const inventoryWasDeducted = orderData.payment_status !== 'unpaid'
                    && orderData.status !== 'unpaid';
                
                // PHASE 1: READ ALL INVENTORY DOCS FIRST
                const inventoryReads = [];
                if (inventoryWasDeducted) {
                    for (const item of items) {
                        const invRef = doc(db, INVENTORY_COLLECTION, item.product_id);
                        const invDoc = await transaction.get(invRef);
                        inventoryReads.push({ item, invRef, invDoc });
                    }
                }
                
                // PHASE 2: RESTORE STOCK
                for (const { item, invRef, invDoc } of inventoryReads) {
                    let multiplier = 1;
                    if (item.selected_unit === 'bulk') {
                        const baseUnitLower = (item.base_unit || "").toLowerCase().trim();
                        const bulkUnitLower = (item.bulk_unit_name || "").toLowerCase().trim();
                        const isSameUnit = baseUnitLower && bulkUnitLower && baseUnitLower === bulkUnitLower;
                        multiplier = isSameUnit ? 1 : (item.bulk_unit_conversion || 1);
                    }
                    const restoreQty = Number(item.qty) * multiplier;
                    
                    let beforeStock = 0;
                    if (invDoc.exists()) {
                        beforeStock = invDoc.data().current_stock_base || 0;
                        const newStock = beforeStock + restoreQty;
                        transaction.update(invRef, {
                            current_stock_base: newStock
                        });
                    } else {
                        const newStock = restoreQty;
                        transaction.set(invRef, {
                            product_id: item.product_id,
                            current_stock_base: newStock
                        });
                    }
                    const afterStock = beforeStock + restoreQty;

                    // Log stock movement inside transaction
                    inventoryService.logMovementTx(transaction, {
                        product_id: item.product_id,
                        transaction_id: orderId,
                        transaction_type: 'sale_cancelled',
                        change_qty: restoreQty,
                        stock_before: beforeStock,
                        stock_after: afterStock,
                        operator: operatorEmail || null
                    });
                }
                
                // Update Order Status to 'cancelled'
                transaction.update(orderRef, {
                    status: 'cancelled',
                    cancelled_at: new Date().toISOString()
                });
            });
        } catch (error) {
            console.error("Failed to cancel order:", error);
            throw error;
        }
    }
};
