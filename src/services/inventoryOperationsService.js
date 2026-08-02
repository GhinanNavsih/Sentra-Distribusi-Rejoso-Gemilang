import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase.config';
import { getEnvMode } from '../utils/envMode';

export const createOperationId = () => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `op_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
};

const translateCallableError = (error) => {
    const details = error?.details || {};
    if (details.kind === 'insufficient-stock') {
        const translated = new Error(error.message || 'Stok tidak mencukupi.');
        translated.name = 'InsufficientStockError';
        translated.details = details.items || [];
        return translated;
    }
    if (details.kind === 'stale-stock') {
        const translated = new Error(error.message || 'Stok telah berubah.');
        translated.name = 'StaleStockError';
        translated.currentStock = details.current_stock;
        translated.details = details;
        return translated;
    }
    if (details.kind === 'legacy-metadata-review') {
        const translated = new Error(error.message || 'Transaksi lama ini perlu ditinjau sebelum dapat diubah.');
        translated.name = 'LegacyMetadataError';
        translated.details = details;
        return translated;
    }
    return error;
};

export const callInventoryOperation = async (functionName, payload, operationId = null) => {
    const operation_id = operationId || createOperationId();
    const callable = httpsCallable(functions, functionName);
    try {
        const response = await callable({
            ...payload,
            environment: getEnvMode(),
            operation_id
        });
        return response.data;
    } catch (error) {
        throw translateCallableError(error);
    }
};
