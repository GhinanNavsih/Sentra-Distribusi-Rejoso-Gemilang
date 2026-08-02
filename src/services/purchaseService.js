import { db } from '../firebase.config';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { getCollectionName } from '../utils/envMode';
import { callInventoryOperation } from './inventoryOperationsService';

export const purchaseService = {
    createPurchase: async (purchaseData, operationId = null) => {
        const result = await callInventoryOperation('receivePurchase', {
            items: purchaseData.items || [],
            supplier_name: purchaseData.supplier_name,
            receipt_file: purchaseData.receipt_file,
            source: purchaseData.source || 'bulk_purchase'
        }, operationId);
        return result.purchase_id;
    },

    updatePurchase: async (purchaseId, updatedItems, _editorEmail = null, operationId = null) => {
        await callInventoryOperation('editTransaction', {
            transaction_id: purchaseId,
            transaction_type: 'purchase',
            items: updatedItems
        }, operationId);
    },

    cancelPurchase: async (purchaseId, _operatorEmail = null, operationId = null) => {
        await callInventoryOperation('cancelTransaction', {
            transaction_id: purchaseId,
            transaction_type: 'purchase'
        }, operationId);
    },

    getAllPurchases: async () => {
        const collectionName = getCollectionName('purchases');
        const purchaseQuery = query(collection(db, collectionName), orderBy('created_at', 'desc'));
        const snapshot = await getDocs(purchaseQuery);
        return snapshot.docs.map(document => ({
            id: document.id,
            ...document.data()
        }));
    }
};
