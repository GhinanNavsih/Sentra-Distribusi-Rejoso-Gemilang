import React, { useState } from 'react';
import { inventoryService } from '../services/inventoryService';
import { orderService } from '../services/orderService';
import { purchaseService } from '../services/purchaseService';
import { stockLossService } from '../services/stockLossService';

const formatCurrency = (value) => {
    if (!value) return "Rp 0";
    return new Intl.NumberFormat("id-ID", {
        style: "currency", currency: "IDR",
        minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(value);
};

// Step 1: Enter new stock amount
function StepSetStock({ product, onCancel, onNext }) {
    const [newStock, setNewStock] = useState(product.current_stock || 0);
    const currentStock = product.current_stock || 0;
    const diff = newStock - currentStock;

    return (
        <div className="p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Tetapkan Stok</h2>
            <p className="text-sm text-gray-500 mb-6">{product.name} ({product.sku})</p>

            <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <div className="flex justify-between items-center mb-3">
                    <span className="text-sm text-gray-500">Stok saat ini</span>
                    <span className="text-lg font-bold text-gray-900">{currentStock} {product.base_unit}</span>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Stok baru</label>
                    <input
                        type="number"
                        value={newStock}
                        onChange={(e) => setNewStock(Number(e.target.value))}
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

            <div className="flex justify-end gap-3">
                <button onClick={onCancel} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm font-medium">
                    Batal
                </button>
                <button
                    onClick={() => onNext(newStock)}
                    disabled={diff === 0}
                    className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-red-700 text-sm font-bold disabled:opacity-40"
                >
                    Lanjutkan
                </button>
            </div>
        </div>
    );
}

// Step 2a: Stock DECREASED — ask reason
function StepStockDecrease({ product, currentStock, newStock, onCancel, onDone }) {
    const diff = currentStock - newStock;
    const [mode, setMode] = useState(null); // 'sold' or 'lost'
    const [lossReason, setLossReason] = useState('');
    const [orderDate, setOrderDate] = useState(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    const [priceTier, setPriceTier] = useState('regular');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const lossReasons = [
        { value: 'expired', label: 'Stock sudah kadaluarsa' },
        { value: 'damaged', label: 'Stock rusak' },
        { value: 'missing', label: 'Stock hilang' },
        { value: 'wrong_input', label: 'Stock salah input di awal' },
    ];

    const getUnitPrice = () => {
        if (priceTier === 'premium') return product.price_premium || 0;
        if (priceTier === 'star') return product.price_star || 0;
        return product.price_regular || 0;
    };

    const handleSubmit = async () => {
        setLoading(true);
        setError(null);
        try {
            if (mode === 'sold') {
                const unitPrice = getUnitPrice();
                // Create order record (bypass inventory deduction — we set stock directly)
                const orderData = {
                    items: [{
                        product_id: product.sku,
                        product_name: product.name,
                        qty: diff,
                        unit_price: unitPrice,
                        total: diff * unitPrice
                    }],
                    grand_total: diff * unitPrice,
                    customer_type: priceTier,
                    order_date: orderDate,
                    source: 'stock_adjustment'
                };
                await orderService.createOrderRecord(orderData);
            } else {
                // Stock loss — record in stock_losses collection
                await stockLossService.createLoss({
                    product_id: product.sku,
                    product_name: product.name,
                    qty: diff,
                    reason: lossReason,
                    cost_price: product.cost_price || 0,
                    estimated_loss: diff * (product.cost_price || 0),
                });
            }

            // Set the new stock level
            await inventoryService.setStock(product.sku, newStock);
            onDone();
        } catch (err) {
            setError(err.message);
            setLoading(false);
        }
    };

    // Mode selection
    if (!mode) {
        return (
            <div className="p-6">
                <h2 className="text-lg font-bold text-gray-900 mb-1">Stok Berkurang</h2>
                <p className="text-sm text-gray-500 mb-6">
                    <span className="font-semibold text-red-600">−{diff} {product.base_unit}</span> dari {product.name}. Apa penyebabnya?
                </p>

                <div className="space-y-3">
                    <button
                        onClick={() => setMode('sold')}
                        className="w-full p-4 border-2 border-gray-200 rounded-xl hover:border-green-400 hover:bg-green-50 transition text-left group"
                    >
                        <div className="font-bold text-gray-900 group-hover:text-green-700">Terjual / Ditransaksikan</div>
                        <div className="text-xs text-gray-500 mt-0.5">Catat sebagai penjualan</div>
                    </button>
                    <button
                        onClick={() => setMode('lost')}
                        className="w-full p-4 border-2 border-gray-200 rounded-xl hover:border-amber-400 hover:bg-amber-50 transition text-left group"
                    >
                        <div className="font-bold text-gray-900 group-hover:text-amber-700">Stok Hilang / Rusak</div>
                        <div className="text-xs text-gray-500 mt-0.5">Stok berkurang tanpa transaksi</div>
                    </button>
                </div>

                <div className="flex justify-start mt-6">
                    <button onClick={onCancel} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm font-medium">
                        Kembali
                    </button>
                </div>
            </div>
        );
    }

    // Mode: sold
    if (mode === 'sold') {
        const unitPrice = getUnitPrice();
        return (
            <div className="p-6">
                <h2 className="text-lg font-bold text-gray-900 mb-1">Catat Penjualan</h2>
                <p className="text-sm text-gray-500 mb-5">
                    {diff} {product.base_unit} × {product.name}
                </p>

                {error && <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{error}</div>}

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Tanggal Transaksi</label>
                        <input
                            type="date"
                            value={orderDate}
                            onChange={(e) => setOrderDate(e.target.value)}
                            className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Tingkat Harga</label>
                        <div className="grid grid-cols-3 gap-2">
                            {[
                                { key: 'regular', label: 'Reguler', price: product.price_regular, color: 'blue' },
                                { key: 'premium', label: 'Premium', price: product.price_premium, color: 'yellow' },
                                { key: 'star', label: 'Bintang', price: product.price_star, color: 'purple' },
                            ].map(tier => (
                                <button
                                    key={tier.key}
                                    type="button"
                                    onClick={() => setPriceTier(tier.key)}
                                    className={`p-3 rounded-lg border-2 text-center transition ${priceTier === tier.key
                                        ? `border-${tier.color}-500 bg-${tier.color}-50 ring-1 ring-${tier.color}-500`
                                        : 'border-gray-200 hover:border-gray-300'
                                        }`}
                                >
                                    <div className="text-xs font-bold uppercase text-gray-600">{tier.label}</div>
                                    <div className="text-sm font-bold text-gray-900 mt-0.5">{formatCurrency(tier.price || 0)}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-4 text-center">
                        <div className="text-xs text-gray-500 uppercase font-bold">Total</div>
                        <div className="text-2xl font-bold text-gray-900 mt-1">
                            {formatCurrency(diff * unitPrice)}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">{diff} × {formatCurrency(unitPrice)}</div>
                    </div>
                </div>

                <div className="flex justify-between mt-6">
                    <button onClick={() => setMode(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm font-medium">
                        Kembali
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={loading}
                        className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-bold disabled:opacity-50"
                    >
                        {loading ? 'Menyimpan...' : 'Simpan Penjualan'}
                    </button>
                </div>
            </div>
        );
    }

    // Mode: lost
    return (
        <div className="p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Alasan Stok Berkurang</h2>
            <p className="text-sm text-gray-500 mb-5">
                <span className="font-semibold text-red-600">−{diff} {product.base_unit}</span> dari {product.name}
            </p>

            {error && <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{error}</div>}

            <div className="space-y-2 mb-6">
                {lossReasons.map(reason => (
                    <button
                        key={reason.value}
                        type="button"
                        onClick={() => setLossReason(reason.value)}
                        className={`w-full p-3 rounded-lg border-2 text-left text-sm font-medium transition ${lossReason === reason.value
                            ? 'border-amber-500 bg-amber-50 text-amber-800'
                            : 'border-gray-200 text-gray-700 hover:border-gray-300'
                            }`}
                    >
                        {reason.label}
                    </button>
                ))}
            </div>

            <div className="flex justify-between">
                <button onClick={() => setMode(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm font-medium">
                    Kembali
                </button>
                <button
                    onClick={handleSubmit}
                    disabled={loading || !lossReason}
                    className="px-6 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm font-bold disabled:opacity-40"
                >
                    {loading ? 'Menyimpan...' : 'Konfirmasi'}
                </button>
            </div>
        </div>
    );
}

// Step 2b: Stock INCREASED — confirm purchase
function StepStockIncrease({ product, currentStock, newStock, onCancel, onDone }) {
    const diff = newStock - currentStock;
    const [unitCost, setUnitCost] = useState(product.cost_price || 0);
    const subtotal = diff * unitCost;
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleSubtotalChange = (val) => {
        const sub = Number(val) || 0;
        setUnitCost(diff > 0 ? Math.round(sub / diff) : 0);
    };

    const handleSubmit = async () => {
        setLoading(true);
        setError(null);
        try {
            // Create purchase record
            const purchaseData = {
                items: [{
                    product_id: product.sku,
                    product_name: product.name,
                    qty: diff,
                    unit_price: unitCost,
                    total: subtotal
                }],
                grand_total: subtotal,
                source: 'stock_adjustment'
            };
            await purchaseService.createPurchase(purchaseData);

            // Set new stock
            await inventoryService.setStock(product.sku, newStock);
            onDone();
        } catch (err) {
            setError(err.message);
            setLoading(false);
        }
    };

    return (
        <div className="p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Konfirmasi Pembelian</h2>
            <p className="text-sm text-gray-500 mb-5">
                <span className="font-semibold text-green-600">+{diff} {product.base_unit}</span> {product.name}
            </p>

            {error && <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{error}</div>}

            <div className="space-y-4">
                <div className="bg-blue-50 rounded-lg p-4">
                    <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Jumlah pembelian</span>
                        <span className="text-lg font-bold text-blue-700">{diff} {product.base_unit}</span>
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Harga per {product.base_unit}</label>
                    <div className="relative">
                        <span className="absolute left-3 top-3 text-gray-400 text-sm">Rp</span>
                        <input
                            type="number"
                            value={unitCost}
                            onChange={(e) => setUnitCost(Number(e.target.value) || 0)}
                            className="w-full pl-9 p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-bold"
                            min="0"
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Subtotal</label>
                    <div className="relative">
                        <span className="absolute left-3 top-3 text-gray-400 text-sm">Rp</span>
                        <input
                            type="number"
                            value={subtotal}
                            onChange={(e) => handleSubtotalChange(e.target.value)}
                            className="w-full pl-9 p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-bold"
                            min="0"
                        />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{diff} × {formatCurrency(unitCost)}</p>
                </div>
            </div>

            <div className="flex justify-between mt-6">
                <button onClick={onCancel} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm font-medium">
                    Kembali
                </button>
                <button
                    onClick={handleSubmit}
                    disabled={loading}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-bold disabled:opacity-50"
                >
                    {loading ? 'Menyimpan...' : 'Simpan Pembelian'}
                </button>
            </div>
        </div>
    );
}

// Main Modal
export default function SetStockModal({ product, onClose, onSuccess }) {
    const [step, setStep] = useState('set'); // 'set', 'decrease', 'increase'
    const [newStockValue, setNewStockValue] = useState(null);
    const currentStock = product.current_stock || 0;

    const handleNext = (newStock) => {
        setNewStockValue(newStock);
        if (newStock < currentStock) {
            setStep('decrease');
        } else if (newStock > currentStock) {
            setStep('increase');
        }
    };

    const handleDone = () => {
        if (onSuccess) onSuccess();
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-y-auto max-h-[90vh]" onClick={e => e.stopPropagation()}>
                {step === 'set' && (
                    <StepSetStock product={product} onCancel={onClose} onNext={handleNext} />
                )}
                {step === 'decrease' && (
                    <StepStockDecrease
                        product={product}
                        currentStock={currentStock}
                        newStock={newStockValue}
                        onCancel={() => setStep('set')}
                        onDone={handleDone}
                    />
                )}
                {step === 'increase' && (
                    <StepStockIncrease
                        product={product}
                        currentStock={currentStock}
                        newStock={newStockValue}
                        onCancel={() => setStep('set')}
                        onDone={handleDone}
                    />
                )}
            </div>
        </div>
    );
}
