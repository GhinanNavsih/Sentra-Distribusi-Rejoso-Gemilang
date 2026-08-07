import React, { useState } from 'react';
import { inventoryService } from '../services/inventoryService';

function SetStockForm({ product, onCancel, onDone }) {
    const currentStock = Number(product.current_stock) || 0;
    const [newStock, setNewStock] = useState(currentStock);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const stockValue = newStock === '' ? 0 : Number(newStock);
    const diff = stockValue - currentStock;

    const handleSubmit = async () => {
        if (!Number.isFinite(stockValue) || stockValue < 0) {
            setError('Stok baru harus berupa angka nol atau lebih.');
            return;
        }

        setLoading(true);
        setError(null);
        try {
            // A stock count corrects the inventory balance only. It must not
            // create an order, purchase, or stock-loss record.
            await inventoryService.adjustStock({
                productId: product.id || product.sku,
                expectedCurrentStock: currentStock,
                newStock: stockValue,
                adjustmentKind: 'stock_count',
                reason: 'wrong_input'
            });
            onDone();
        } catch (err) {
            setError(err.name === 'StaleStockError'
                ? `${err.message} Stok terbaru: ${err.currentStock} ${product.base_unit}.`
                : err.message);
            setLoading(false);
        }
    };

    return (
        <div className="p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Tetapkan Stok</h2>
            <p className="text-sm text-gray-500 mb-6">{product.name} ({product.sku})</p>

            <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-4">
                <p className="text-sm text-blue-800">
                    Penyesuaian ini hanya memperbaiki saldo stok karena salah input.
                    Tidak dicatat sebagai pembelian, penjualan, atau kehilangan stok.
                </p>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <div className="flex justify-between items-center mb-3">
                    <span className="text-sm text-gray-500">Stok saat ini</span>
                    <span className="text-lg font-bold text-gray-900">{currentStock} {product.base_unit}</span>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Stok baru</label>
                    <input
                        type="number"
                        step="any"
                        value={newStock}
                        onChange={(event) => {
                            const value = event.target.value;
                            if (value && value.startsWith('-')) return;
                            const clean = value.replace(/,/g, '.');
                            setNewStock(clean === '' ? '' : Number(clean));
                        }}
                        onWheel={(event) => event.currentTarget.blur()}
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none font-bold text-xl text-center"
                        min="0"
                        autoFocus
                    />
                </div>
                {diff !== 0 && (
                    <div className={`mt-3 text-center text-sm font-semibold rounded-md py-1.5 ${diff > 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                        {diff > 0 ? `+${diff}` : diff} {product.base_unit}
                    </div>
                )}
            </div>

            {error && <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{error}</div>}

            <div className="flex justify-end gap-3">
                <button
                    onClick={onCancel}
                    disabled={loading}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm font-medium disabled:opacity-50"
                >
                    Batal
                </button>
                <button
                    onClick={handleSubmit}
                    disabled={loading || diff === 0}
                    className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-red-700 text-sm font-bold disabled:opacity-40"
                >
                    {loading ? 'Menyimpan...' : 'Simpan Penyesuaian'}
                </button>
            </div>
        </div>
    );
}

export default function SetStockModal({ product, onClose, onSuccess }) {
    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-y-auto max-h-[90vh]" onClick={event => event.stopPropagation()}>
                <SetStockForm product={product} onCancel={onClose} onDone={onSuccess} />
            </div>
        </div>
    );
}
