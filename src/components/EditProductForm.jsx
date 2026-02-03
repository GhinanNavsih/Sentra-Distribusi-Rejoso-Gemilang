import React, { useState, useEffect } from 'react';
import { productService } from '../services/productService';
import { inventoryService } from '../services/inventoryService';

export default function EditProductForm({ product, onClose, onSuccess }) {
    const [formData, setFormData] = useState({
        name: '',
        sku: '',
        base_unit: 'kg',
        bulk_unit_name: 'Sack',
        bulk_unit_conversion: 50,
        cost_price: 0,
        current_stock: 0,
        price_tiers: [{ min_qty: 1, price: 0 }]
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (product) {
            setFormData({
                ...product,
                cost_price: product.cost_price || 0,
                current_stock: product.current_stock || 0,
                // Ensure price tiers is always an array
                price_tiers: product.price_tiers || [{ min_qty: 1, price: 0 }]
            });
        }
    }, [product]);

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
            // Ensure numbers
            const payload = {
                // id: formData.id, // Only use SKU as ID
                name: formData.name,
                sku: formData.sku,
                base_unit: formData.base_unit,
                bulk_unit_name: formData.bulk_unit_name,
                bulk_unit_conversion: Number(formData.bulk_unit_conversion),
                cost_price: Number(formData.cost_price),
                price_tiers: formData.price_tiers
            };

            // Check for Rename (SKU change)
            if (product.sku !== formData.sku) {
                // Create NEW records first
                await Promise.all([
                    productService.saveProduct(payload),
                    inventoryService.setStock(formData.sku, Number(formData.current_stock))
                ]);

                // Delete OLD records
                await Promise.all([
                    productService.deleteProduct(product.sku),
                    inventoryService.deleteStock(product.sku)
                ]);
            } else {
                // Normal Update
                await Promise.all([
                    productService.saveProduct(payload),
                    inventoryService.setStock(formData.sku, Number(formData.current_stock))
                ]);
            }

            if (onSuccess) onSuccess();
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        const confirmMessage = `Are you sure you want to DELETE "${product.name}" (${product.sku})?\n\nThis will permanently remove:\n- Product record\n- Inventory data\n- All associated information\n\nThis action CANNOT be undone!`;

        if (!confirm(confirmMessage)) return;

        setLoading(true);
        setError(null);
        try {
            // Delete both product and inventory records
            await Promise.all([
                productService.deleteProduct(product.sku),
                inventoryService.deleteStock(product.sku)
            ]);

            alert(`Product "${product.name}" has been deleted successfully.`);
            if (onSuccess) onSuccess();
        } catch (err) {
            setError(`Failed to delete product: ${err.message}`);
            setLoading(false);
        }
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 max-w-2xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-gray-900">Edit Product: {product?.sku}</h2>
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
                        <label className="block text-sm font-medium text-gray-700 mb-1">SKU (ID)</label>
                        <input required type="text" name="sku" value={formData.sku} onChange={handleChange}
                            className="w-full p-2 border border-blue-200 bg-blue-50 rounded text-gray-900 focus:ring-1 focus:ring-primary focus:border-primary outline-none" />
                        <p className="text-[10px] text-gray-500 mt-1">Changing SKU will effectively rename the product.</p>
                    </div>

                    {/* Stock Level - Moved here for visibility */}
                    <div className="md:col-span-2 bg-blue-50 p-4 rounded border border-blue-200">
                        <label className="block text-sm font-bold text-gray-900 mb-1">Current Stock Level</label>
                        <p className="text-xs text-gray-500 mb-2">Manually adjust the stock amount ({formData.base_unit}). Valid for stock corrections.</p>
                        <input type="number" name="current_stock" value={formData.current_stock} onChange={handleChange}
                            className="w-full p-2 border border-blue-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none font-bold text-lg" />
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
                    <div className="mb-4">
                        <label className="block text-sm font-bold text-gray-900 mb-1">Purchase Value (Cost Price)</label>
                        <p className="text-xs text-gray-500 mb-2">The average cost to buy this item (per base unit).</p>
                        <div className="relative">
                            <span className="absolute left-3 top-2 text-gray-500 text-sm">Rp</span>
                            <input type="number" name="cost_price" value={formData.cost_price || 0} onChange={handleChange}
                                className="w-full pl-9 p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none" placeholder="0" />
                        </div>
                    </div>

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

                <div className="flex justify-between items-center gap-3 pt-4 border-t border-gray-100">
                    {/* Delete Button - Left Side */}
                    <button
                        type="button"
                        onClick={handleDelete}
                        disabled={loading}
                        className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm font-medium shadow-sm disabled:opacity-50 flex items-center gap-2"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Delete Product
                    </button>

                    {/* Right Side Buttons */}
                    <div className="flex gap-3">
                        {onClose && (
                            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 text-sm font-medium">
                                Cancel
                            </button>
                        )}
                        <button disabled={loading} type="submit" className="px-6 py-2 bg-primary text-white rounded hover:bg-red-700 text-sm font-bold shadow-sm disabled:opacity-50">
                            {loading ? 'Saving Changes...' : 'Update Product'}
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
}
