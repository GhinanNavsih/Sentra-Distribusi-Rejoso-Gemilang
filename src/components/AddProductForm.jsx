import React, { useState } from 'react';
import { productService } from '../services/productService';

export default function AddProductForm({ onClose, onSuccess }) {
    const [formData, setFormData] = useState({
        name: '',
        sku: '',
        base_unit: 'kg',
        bulk_unit_name: 'Sack',
        bulk_unit_conversion: 50,
        price_regular: 0,
        price_premium: 0,
        price_star: 0
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
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

                        {/* Star */}
                        <div>
                            <label className="block text-xs uppercase text-purple-600 mb-1 font-bold">Harga Bintang (VIP)</label>
                            <div className="relative">
                                <span className="absolute left-3 top-2 text-gray-400 text-sm">Rp</span>
                                <input type="number" name="price_star" required value={formData.price_star} onChange={handleChange}
                                    className="w-full pl-9 p-2 border border-purple-200 bg-purple-50 rounded focus:ring-1 focus:ring-purple-500 focus:border-purple-500 outline-none font-bold text-purple-900"
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
