import React, { useState } from 'react';
import { productService } from '../services/productService';

export default function AddProductForm({ onClose, onSuccess }) {
    const [formData, setFormData] = useState({
        name: '',
        sku: '',
        base_unit: 'kg',
        bulk_unit_name: 'Sack',
        bulk_unit_conversion: 50,
        price_tiers: [{ min_qty: 1, price: 0 }]
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleTierChange = (index, field, value) => {
        const newTiers = [...formData.price_tiers];
        newTiers[index][field] = Number(value);
        setFormData(prev => ({ ...prev, price_tiers: newTiers }));
    };

    const addTier = () => {
        setFormData(prev => ({
            ...prev,
            price_tiers: [...prev.price_tiers, { min_qty: 1, price: 0 }]
        }));
    };

    const removeTier = (index) => {
        if (formData.price_tiers.length === 1) return;
        const newTiers = formData.price_tiers.filter((_, i) => i !== index);
        setFormData(prev => ({ ...prev, price_tiers: newTiers }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            await productService.saveProduct(formData);
            if (onSuccess) onSuccess();
            if (onClose) onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 max-w-2xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-gray-900">Add New Product</h2>
                {onClose && (
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                        &times;
                    </button>
                )}
            </div>

            {error && <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{error}</div>}

            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Basic Info */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
                        <input required type="text" name="name" value={formData.name} onChange={handleChange}
                            className="w-full p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none" placeholder="e.g. White Sugar" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">SKU (Unique ID)</label>
                        <input required type="text" name="sku" value={formData.sku} onChange={handleChange}
                            className="w-full p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none" placeholder="e.g. SUGAR-001" />
                    </div>

                    {/* Units */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Base Unit</label>
                        <select name="base_unit" value={formData.base_unit} onChange={handleChange}
                            className="w-full p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none">
                            <option value="kg">Kilogram (kg)</option>
                            <option value="g">Gram (g)</option>
                            <option value="ltr">Liter (ltr)</option>
                            <option value="pcs">Pieces (pcs)</option>
                            <option value="sack">Sack (sack)</option>
                            <option value="box">Box (box)</option>
                            <option value="ball">Ball (ball)</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Bulk Unit Name</label>
                        <input type="text" name="bulk_unit_name" value={formData.bulk_unit_name} onChange={handleChange}
                            className="w-full p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none" placeholder="e.g. Sack" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Bulk Conversion</label>
                        <div className="flex items-center">
                            <span className="mr-2 text-sm text-gray-500">1 {formData.bulk_unit_name || 'Bulk'} = </span>
                            <input type="number" name="bulk_unit_conversion" value={formData.bulk_unit_conversion} onChange={handleChange}
                                className="w-24 p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none" />
                            <span className="ml-2 text-sm text-gray-500">{formData.base_unit}</span>
                        </div>
                    </div>
                </div>

                {/* Pricing Tiers */}
                <div className="bg-gray-50 p-4 rounded border border-gray-200">
                    <label className="block text-sm font-bold text-gray-900 mb-3">Pricing Tiers (Sell Out)</label>
                    <div className="space-y-3">
                        {formData.price_tiers.map((tier, idx) => (
                            <div key={idx} className="flex items-end gap-3">
                                <div>
                                    <label className="block text-xs uppercase text-gray-500 mb-1">Min Qty</label>
                                    <input type="number" value={tier.min_qty} onChange={(e) => handleTierChange(idx, 'min_qty', e.target.value)}
                                        className="w-24 p-2 border border-gray-300 rounded text-sm" />
                                </div>
                                <div className="flex-1">
                                    <label className="block text-xs uppercase text-gray-500 mb-1">Unit Price</label>
                                    <input type="number" value={tier.price} onChange={(e) => handleTierChange(idx, 'price', e.target.value)}
                                        className="w-full p-2 border border-gray-300 rounded text-sm" placeholder="e.g. 15000" />
                                </div>
                                {formData.price_tiers.length > 1 && (
                                    <button type="button" onClick={() => removeTier(idx)} className="p-2 text-red-600 hover:bg-red-50 rounded">
                                        &times;
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                    <button type="button" onClick={addTier} className="mt-4 text-sm text-primary font-medium hover:underline">
                        + Add Another Price Tier
                    </button>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                    {onClose && (
                        <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 text-sm font-medium">
                            Cancel
                        </button>
                    )}
                    <button disabled={loading} type="submit" className="px-6 py-2 bg-primary text-white rounded hover:bg-red-700 text-sm font-bold shadow-sm disabled:opacity-50">
                        {loading ? 'Saving...' : 'Save Product'}
                    </button>
                </div>
            </form>
        </div>
    );
}
