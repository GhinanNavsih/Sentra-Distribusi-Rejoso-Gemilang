import { db } from '../firebase.config';
import { doc, getDoc } from 'firebase/firestore';
import { getCollectionName } from '../utils/envMode';
import { callInventoryOperation } from './inventoryOperationsService';

const directWriteError = () => {
    throw new Error('Penulisan stok langsung dinonaktifkan. Gunakan operasi inventori yang memiliki alasan dan audit log.');
};

export const inventoryService = {
    getStock: async (sku) => {
        const docRef = doc(db, getCollectionName('inventory'), sku);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) return 0;

        const stock = Number(docSnap.data().current_stock_base);
        if (!Number.isFinite(stock)) {
            throw new Error(`Nilai stok ${sku} tidak valid dan perlu direkonsiliasi.`);
        }
        return stock;
    },

    adjustStock: async ({
        productId,
        expectedCurrentStock,
        newStock,
        adjustmentKind,
        reason = null,
        priceTier = null,
        orderDate = null,
        costPerUnit = null,
        operationId = null
    }) => callInventoryOperation('adjustStock', {
        product_id: productId,
        expected_current_stock: expectedCurrentStock,
        new_stock: newStock,
        adjustment_kind: adjustmentKind,
        reason,
        price_tier: priceTier,
        order_date: orderDate,
        cost_per_unit: costPerUnit
    }, operationId),

    repack: async (fromSku, toSku, qtyToOpen, conversionRate, operationId = null) =>
        callInventoryOperation('repackStock', {
            from_sku: fromSku,
            to_sku: toSku,
            qty_to_open: qtyToOpen,
            conversion_rate: conversionRate
        }, operationId),

    getHealth: async () => callInventoryOperation('inventoryHealth', {}),

    updateStock: directWriteError,
    setStock: directWriteError,
    deleteStock: directWriteError
};
