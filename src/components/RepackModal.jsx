import React, { useState, useEffect } from 'react';
import { inventoryService } from '../services/inventoryService';
import { productService } from '../services/productService';

export default function RepackModal({ onClose, onSuccess }) {
    const [products, setProducts] = useState([]);
    const [loadingProducts, setLoadingProducts] = useState(true);


    const [fromSku, setFromSku] = useState('');
    const [toSku, setToSku] = useState('');
    const [qtyToOpen, setQtyToOpen] = useState(1);
    const [conversionRate, setConversionRate] = useState(50);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        productService.getAllProducts().then(list => {
            setProducts(list);
            setLoadingProducts(false);
        });
    }, []);

    const handleRepack = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await inventoryService.repack(fromSku, toSku, Number(qtyToOpen), Number(conversionRate));
            onSuccess();
        } catch (error) {
            alert("Repack failed: " + error.message);
        } finally {
            setSubmitting(false);
        }
    };

    const getSourceProduct = () => products.find(p => p.sku === fromSku);
    const getTargetProduct = () => products.find(p => p.sku === toSku);

    // Auto-populate conversion rate if source has standard
    useEffect(() => {
        const source = getSourceProduct();
        if (source && source.bulk_unit_conversion) {
            setConversionRate(source.bulk_unit_conversion);
        }
    }, [fromSku, products]);

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-4">Repack Item (Break Bulk)</h2>

                {loadingProducts ? (
                    <div className="py-10 text-center">Loading products...</div>
                ) : (
                    <form onSubmit={handleRepack} className="space-y-6">
                        {/* Item Selection */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Source (Bulk)</label>
                                <select required value={fromSku} onChange={e => setFromSku(e.target.value)}
                                    className="w-full p-2 border border-gray-300 rounded text-sm focus:ring-primary focus:border-primary">
                                    <option value="">Select Bulk Item...</option>
                                    {products.map(p => (
                                        <option key={p.sku} value={p.sku}>{p.name}</option>
                                    ))}
                                </select>
                                {fromSku && (
                                    <p className="text-xs text-gray-400 mt-1">Open this unit...</p>
                                )}
                            </div>
                            <div className="flex items-center justify-center pt-6">
                                <div className="text-gray-400">➔</div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Target (Loose)</label>
                                <select required value={toSku} onChange={e => setToSku(e.target.value)}
                                    className="w-full p-2 border border-gray-300 rounded text-sm focus:ring-primary focus:border-primary">
                                    <option value="">Select Loose Item...</option>
                                    {products.map(p => (
                                        <option disabled={p.sku === fromSku} key={p.sku} value={p.sku}>{p.name}</option>
                                    ))}
                                </select>
                                {toSku && (
                                    <p className="text-xs text-gray-400 mt-1">..add to here.</p>
                                )}
                            </div>
                        </div>

                        {/* Logic Inputs */}
                        {fromSku && toSku && (
                            <div className="bg-gray-50 p-4 rounded border border-gray-200 space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-900">How many units to open?</label>
                                    <div className="flex items-center gap-2 mt-1">
                                        <input type="number" min="1" required value={qtyToOpen} onChange={e => setQtyToOpen(e.target.value)}
                                            className="w-24 p-2 border border-gray-300 rounded font-bold" />
                                        <span className="text-gray-600 font-medium">
                                            {getSourceProduct()?.bulk_unit_name || 'Units'} of {getSourceProduct()?.name}
                                        </span>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-900">Conversion Rate</label>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="text-gray-500 text-sm">1 Unit contains</span>
                                        <input type="number" min="1" required value={conversionRate} onChange={e => setConversionRate(e.target.value)}
                                            className="w-24 p-2 border border-gray-300 rounded font-bold" />
                                        <span className="text-gray-600 font-medium">
                                            {getTargetProduct()?.base_unit} of {getTargetProduct()?.name}
                                        </span>
                                    </div>
                                </div>

                                <div className="bg-blue-50 p-3 rounded text-sm text-blue-800 border border-blue-100 mt-2">
                                    <strong>Result:</strong> Deduct {qtyToOpen} {getSourceProduct()?.bulk_unit_name} from source.
                                    Add {qtyToOpen * conversionRate} {getTargetProduct()?.base_unit} to target.
                                </div>
                            </div>
                        )}

                        <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 text-sm font-medium">
                                Cancel
                            </button>
                            <button disabled={submitting || !fromSku || !toSku} type="submit" className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-bold shadow-sm disabled:opacity-50">
                                {submitting ? 'Processing...' : 'Confirm Repack'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
