import { db } from '../firebase.config';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { getCollectionName } from '../utils/envMode';
import { callInventoryOperation } from './inventoryOperationsService';

const createSale = async (orderData, paymentStatus, operationId = null) => {
    const result = await callInventoryOperation('createSale', {
        order: {
            ...orderData,
            payment_status: paymentStatus
        }
    }, operationId);
    return result.order_id;
};

export const orderService = {
    createOrder: async (orderData, operationId = null) => createSale(orderData, 'paid', operationId),

    createUnpaidOrder: async (orderData, operationId = null) => createSale(orderData, 'unpaid', operationId),

    createOrderRecord: async () => {
        throw new Error('Pembuatan order tanpa mutasi stok atomik sudah dinonaktifkan.');
    },

    updateOrder: async (orderId, updatedItems, _editorEmail = null, operationId = null, preorder = null) => {
        const payload = {
            transaction_id: orderId,
            transaction_type: 'sale',
            items: updatedItems
        };
        if (preorder) payload.preorder = preorder;
        await callInventoryOperation('editTransaction', payload, operationId);
    },

    payUnpaidOrder: async (orderId, _operatorEmail = null, operationId = null) => {
        await callInventoryOperation('payPreorder', { order_id: orderId }, operationId);
    },

    cancelOrder: async (orderId, _operatorEmail = null, operationId = null) => {
        await callInventoryOperation('cancelTransaction', {
            transaction_id: orderId,
            transaction_type: 'sale'
        }, operationId);
    },

    getAllOrders: async () => {
        const collectionName = getCollectionName('orders');
        const orderQuery = query(collection(db, collectionName), orderBy('created_at', 'desc'));
        const snapshot = await getDocs(orderQuery);
        return snapshot.docs.map(document => ({
            id: document.id,
            ...document.data()
        }));
    }
};
