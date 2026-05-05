import React, { useState } from 'react';
import { productService, PRODUCT_CATEGORIES } from '../services/productService';

export default function AddProductForm({ onClose, onSuccess }) {
    const [formData, setFormData] = useState({
        name: '',
        sku: '',
        base_unit: 'kg',
        bulk_unit_name: 'Sack',
        bulk_unit_conversion: 50,
        price_regular: '',
        price_premium: '',
        price_star: '',
        cost_price: '',
        image_url: '',
        category: 'Lainnya'
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleChange = (e) => {
        const { name, value, type } = e.target;
        // For number inputs, allow empty string to let user clear the field
        const val = type === 'number' ? (value === '' ? '' : Number(value)) : value;
        
        setFormData(prev => {
            const next = { ...prev, [name]: val };
            // Auto-sync VIP price with cost price
            if (name === 'cost_price') {
                next.price_star = val;
            }
            return next;
        });
    };



    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            // Validation for NaN
            const numericFields = ['price_regular', 'price_premium', 'price_star', 'cost_price', 'bulk_unit_conversion'];
            for (const field of numericFields) {
                const val = formData[field];
                if (val !== '' && isNaN(Number(val))) {
                    throw new Error(`Nilai untuk ${field} tidak valid (bukan angka).`);
                }
            }

            const payload = {
                ...formData,
                price_regular: Number(formData.price_regular || 0),
                price_premium: Number(formData.price_premium || 0),
                price_star: Number(formData.price_star || 0),
                cost_price: Number(formData.cost_price || 0),
                bulk_unit_conversion: Number(formData.bulk_unit_conversion || 0)
            };
            await productService.saveProduct(payload);
            if (onSuccess) onSuccess(payload);
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
                <h2 className="text-xl font-bold text-gray-900">Tambah Produk Baru</h2>
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
                    <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Kategori Produk</label>
                        <select name="category" value={formData.category} onChange={handleChange}
                            className="w-full p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none">
                            {PRODUCT_CATEGORIES.map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Nama Produk</label>
                        <input required type="text" name="name" value={formData.name} onChange={handleChange}
                            className="w-full p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none" placeholder="Contoh: Gula Pasir" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">SKU (Kode Unik)</label>
                        <input required type="text" name="sku" value={formData.sku} onChange={handleChange}
                            className="w-full p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none" placeholder="Contoh: GULA-001" />
                    </div>
                    <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">URL Gambar Produk</label>
                        <input type="text" name="image_url" value={formData.image_url} onChange={handleChange}
                            className="w-full p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none" placeholder="https://example.com/image.jpg" />
                    </div>

                    {/* Units */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Satuan Dasar</label>
                        <select name="base_unit" value={formData.base_unit} onChange={handleChange}
                            className="w-full p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none">
                            <option value="kg">Kilogram (kg)</option>
                            <option value="g">Gram (g)</option>
                            <option value="ltr">Liter (ltr)</option>
                            <option value="pcs">Pcs (pcs)</option>
                            <option value="sack">Sak (sack)</option>
                            <option value="box">Box (box)</option>
                            <option value="ball">Ball (ball)</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Nama Satuan Besar</label>
                        <input type="text" name="bulk_unit_name" value={formData.bulk_unit_name} onChange={handleChange}
                            className="w-full p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none" placeholder="Contoh: Sak" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Konversi Satuan Besar</label>
                        <div className="flex items-center">
                            <span className="mr-2 text-sm text-gray-500">1 {formData.bulk_unit_name || 'Besar'} = </span>
                            <input type="number" name="bulk_unit_conversion" value={formData.bulk_unit_conversion} onChange={handleChange}
                                className="w-24 p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none" />
                            <span className="ml-2 text-sm text-gray-500">{formData.base_unit}</span>
                        </div>
                    </div>
                </div>

                {/* Pricing Tiers */}
                {/* Pricing Structure */}
                <div className="bg-gray-50 p-4 rounded border border-gray-200">
                    <div className="mb-4">
                        <label className="block text-sm font-bold text-gray-900 mb-1">Harga Beli (Modal)</label>
                        <p className="text-xs text-gray-500 mb-2">Rata-rata biaya pembelian item ini (per satuan dasar).</p>
                        <div className="relative">
                            <span className="absolute left-3 top-2 text-gray-500 text-sm">Rp</span>
                            <input type="number" name="cost_price" value={formData.cost_price} onChange={handleChange}
                                className="w-full pl-9 p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none" placeholder="0" />
                        </div>
                    </div>

                    <label className="block text-sm font-bold text-gray-900 mb-3">Strategi Harga Jual</label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Regular */}
                        <div>
                            <label className="block text-xs uppercase text-gray-500 mb-1 font-bold">Harga Reguler</label>
                            <div className="relative">
                                <span className="absolute left-3 top-2 text-gray-400 text-sm">Rp</span>
                                <input type="number" name="price_regular" required value={formData.price_regular} onChange={handleChange}
                                    className="w-full pl-9 p-2 border border-blue-200 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none font-bold text-gray-900"
                                    placeholder="0" />
                            </div>
                            <p className="text-[10px] text-gray-400 mt-1">Pelanggan umum</p>
                        </div>

                        {/* Premium */}
                        <div>
                            <label className="block text-xs uppercase text-yellow-600 mb-1 font-bold">Harga Premium</label>
                            <div className="relative">
                                <span className="absolute left-3 top-2 text-gray-400 text-sm">Rp</span>
                                <input type="number" name="price_premium" required value={formData.price_premium} onChange={handleChange}
                                    className="w-full pl-9 p-2 border border-yellow-200 bg-yellow-50 rounded focus:ring-1 focus:ring-yellow-500 focus:border-yellow-500 outline-none font-bold text-yellow-900"
                                    placeholder="0" />
                            </div>
                            <p className="text-[10px] text-gray-400 mt-1">Sedikit potongan harga</p>
                        </div>

                        <div>
                            <label className="block text-xs uppercase text-purple-600 mb-1 font-bold">Harga Bintang <span className="text-[10px] lowercase font-normal">(Sesuai Modal)</span></label>
                            <div className="relative">
                                <span className="absolute left-3 top-2 text-gray-400 text-sm">Rp</span>
                                <input type="number" name="price_star" readOnly value={formData.cost_price}
                                    className="w-full pl-9 p-2 border border-purple-100 bg-purple-50/50 rounded outline-none font-bold text-purple-900 cursor-not-allowed"
                                    placeholder="0" />
                            </div>
                            <p className="text-[10px] text-gray-400 mt-1">Harga termurah / Grosir</p>
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                    {onClose && (
                        <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 text-sm font-medium">
                            Batal
                        </button>
                    )}
                    <button disabled={loading} type="submit" className="px-6 py-2 bg-primary text-white rounded hover:bg-red-700 text-sm font-bold shadow-sm disabled:opacity-50">
                        {loading ? 'Menyimpan...' : 'Simpan Produk'}
                    </button>
                </div>
            </form>
        </div>
    );
}
