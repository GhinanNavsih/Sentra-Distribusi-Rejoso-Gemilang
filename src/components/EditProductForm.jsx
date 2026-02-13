import React, { useState, useEffect } from 'react';
import { productService, PRODUCT_CATEGORIES } from '../services/productService';
import { inventoryService } from '../services/inventoryService';

export default function EditProductForm({ product, onClose, onSuccess }) {
    const [formData, setFormData] = useState({
        name: '',
        sku: '',
        base_unit: 'kg',
        bulk_unit_name: 'Sack',
        bulk_unit_conversion: 50,
        cost_price: 0,
        price_regular: 0,
        price_premium: 0,
        price_star: 0,
        image_url: '',
        category: 'Lainnya'
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (product) {
            setFormData({
                ...product,
                cost_price: product.cost_price || 0,
                price_regular: product.price_regular || 0,
                price_premium: product.price_premium || 0,
                price_star: product.price_star || 0,
                image_url: product.image_url || '',
                category: product.category || 'Lainnya'
            });
        }
    }, [product]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const payload = {
                name: formData.name,
                sku: formData.sku,
                base_unit: formData.base_unit,
                bulk_unit_name: formData.bulk_unit_name,
                bulk_unit_conversion: Number(formData.bulk_unit_conversion),
                cost_price: Number(formData.cost_price),
                price_regular: Number(formData.price_regular),
                price_premium: Number(formData.price_premium),
                price_star: Number(formData.price_star),
                image_url: formData.image_url,
                category: formData.category
            };

            // Check for Rename (SKU change)
            if (product.sku !== formData.sku) {
                // Create NEW product record, then move stock to new SKU
                await productService.saveProduct(payload);
                const currentStock = product.current_stock || 0;
                await inventoryService.setStock(formData.sku, currentStock);

                // Delete OLD records
                await Promise.all([
                    productService.deleteProduct(product.sku),
                    inventoryService.deleteStock(product.sku)
                ]);
            } else {
                // Normal Update — only product data, NOT stock
                await productService.saveProduct(payload);
            }

            if (onSuccess) onSuccess();
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        const confirmMessage = `Apakah Anda yakin ingin MENGHAPUS "${product.name}" (${product.sku})?\n\nTindakan ini akan menghapus secara permanen:\n- Data produk\n- Data stok\n- Semua informasi terkait\n\nTindakan ini TIDAK DAPAT dibatalkan!`;

        if (!confirm(confirmMessage)) return;

        setLoading(true);
        setError(null);
        try {
            // Delete both product and inventory records
            await Promise.all([
                productService.deleteProduct(product.sku),
                inventoryService.deleteStock(product.sku)
            ]);

            alert(`Produk "${product.name}" berhasil dihapus.`);
            if (onSuccess) onSuccess();
        } catch (err) {
            setError(`Gagal menghapus produk: ${err.message}`);
            setLoading(false);
        }
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 max-w-2xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-gray-900">Edit Produk: {product?.sku}</h2>
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
                        <label className="block text-sm font-medium text-gray-700 mb-1">SKU (Kode Produk)</label>
                        <input required type="text" name="sku" value={formData.sku} onChange={handleChange}
                            className="w-full p-2 border border-blue-200 bg-blue-50 rounded text-gray-900 focus:ring-1 focus:ring-primary focus:border-primary outline-none" />
                        <p className="text-[10px] text-gray-500 mt-1">Mengubah SKU akan mengubah kode produk secara permanen.</p>
                    </div>
                    <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">URL Gambar Produk</label>
                        <div className="flex gap-4 items-start">
                            <div className="flex-1">
                                <input type="text" name="image_url" value={formData.image_url} onChange={handleChange}
                                    className="w-full p-2 border border-gray-300 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none" placeholder="https://drive.google.com/..." />
                                <p className="text-[10px] text-gray-400 mt-1">Anda bisa langsung tempel link Google Drive atau link gambar lainnya.</p>
                            </div>
                            {formData.image_url && (
                                <div className="w-16 h-16 bg-gray-50 border rounded overflow-hidden flex-shrink-0">
                                    <img
                                        src={productService.transformDriveUrl(formData.image_url)}
                                        alt="Preview"
                                        className="w-full h-full object-contain"
                                        referrerPolicy="no-referrer"
                                        onError={(e) => { e.target.style.display = 'none'; }}
                                    />
                                </div>
                            )}
                        </div>
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
                <div className="bg-gray-50 p-4 rounded border border-gray-200">
                    <div className="mb-4">
                        <label className="block text-sm font-bold text-gray-900 mb-1">Harga Beli (Modal)</label>
                        <p className="text-xs text-gray-500 mb-2">Rata-rata biaya pembelian item ini (per satuan dasar).</p>
                        <div className="relative">
                            <span className="absolute left-3 top-2 text-gray-500 text-sm">Rp</span>
                            <input type="number" name="cost_price" value={formData.cost_price || 0} onChange={handleChange}
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
                        Hapus Produk
                    </button>

                    {/* Right Side Buttons */}
                    <div className="flex gap-3">
                        {onClose && (
                            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 text-sm font-medium">
                                Batal
                            </button>
                        )}
                        <button disabled={loading} type="submit" className="px-6 py-2 bg-primary text-white rounded hover:bg-red-700 text-sm font-bold shadow-sm disabled:opacity-50">
                            {loading ? 'Menyimpan...' : 'Perbarui Produk'}
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
}
