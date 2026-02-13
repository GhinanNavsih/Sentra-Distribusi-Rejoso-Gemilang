import React, { useState, useEffect } from 'react';
import { productService, PRODUCT_CATEGORIES } from '../services/productService';
import { useAuth } from '../context/AuthContext';
import { useUserRole } from '../hooks/useUserRole';
import EditProductForm from '../components/EditProductForm';

const formatCurrency = (value) => {
    if (!value) return "Rp 0";
    return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value);
};

const CatalogPage = () => {
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const { currentUser } = useAuth();
    const { isSuperAdmin, isShopper } = useUserRole();
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [selectedCategory, setSelectedCategory] = useState("Semua");

    const fetchProducts = async () => {
        setLoading(true);
        try {
            const data = await productService.getAllProducts();
            const sortedData = [...data].sort((a, b) =>
                (a.name || "").localeCompare(b.name || "")
            );
            setProducts(sortedData);
        } catch (error) {
            console.error("Failed to fetch products:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchProducts();
    }, []);

    const canEdit = isSuperAdmin || isShopper;

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="flex justify-between items-center mb-10">
                <div>
                    <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">Katalog Produk</h1>
                    <p className="mt-2 text-lg text-gray-500">Daftar harga terbaik untuk kebutuhan bisnis Anda.</p>
                </div>
            </div>

            {/* Category Tabs */}
            <div className="flex flex-wrap gap-2 mb-8 border-b border-gray-100 pb-4">
                <button
                    onClick={() => setSelectedCategory("Semua")}
                    className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${selectedCategory === "Semua"
                        ? 'bg-primary text-white shadow-md'
                        : 'bg-white text-gray-500 hover:bg-gray-50 border border-gray-200'}`}
                >
                    Semua Produk
                </button>
                {PRODUCT_CATEGORIES.map(cat => (
                    <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${selectedCategory === cat
                            ? 'bg-primary text-white shadow-md'
                            : 'bg-white text-gray-500 hover:bg-gray-50 border border-gray-200'}`}
                    >
                        {cat}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                {products
                    .filter(p => selectedCategory === "Semua" || p.category === selectedCategory)
                    .map((product) => (
                        <div
                            key={product.sku}
                            className="group relative bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-xl transition-all duration-300 flex flex-col"
                        >
                            {/* Mau Lebih Untung Badge */}
                            <div className="absolute top-0 left-0 bg-red-600 text-white text-[10px] font-bold px-3 py-1 rounded-br-lg z-10">
                                Mau Lebih Untung?
                            </div>

                            {/* Image Container */}
                            <div className="aspect-square w-full bg-gray-50 flex items-center justify-center p-6 overflow-hidden">
                                {product.image_url ? (
                                    <img
                                        src={productService.transformDriveUrl(product.image_url)}
                                        alt={product.name}
                                        className="object-contain h-full w-full group-hover:scale-105 transition-transform duration-300"
                                        referrerPolicy="no-referrer"
                                        onError={(e) => {
                                            e.target.src = 'https://placehold.co/400x400?text=No+Image';
                                        }}
                                    />
                                ) : (
                                    <div className="text-gray-300 flex flex-col items-center">
                                        <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                        </svg>
                                        <span className="text-xs mt-2 uppercase font-bold tracking-widest">{product.base_unit}</span>
                                    </div>
                                )}
                            </div>

                            {/* Content */}
                            <div className="p-5 flex-1 flex flex-col">
                                <h3 className="text-sm font-bold text-gray-800 uppercase tracking-tight line-clamp-2 min-h-[2.5rem] mb-4">
                                    {product.name}
                                </h3>

                                {/* Prices Area */}
                                <div className="space-y-3 mt-4">
                                    {(() => {
                                        const premiumPrice = product.price_premium || product.price_regular;
                                        const oldPrice = product.price_regular > premiumPrice ? product.price_regular : Math.floor(product.price_regular * 1.05);

                                        return (
                                            <>
                                                {/* Base Unit Price */}
                                                <div className="flex items-stretch bg-gray-50 rounded-lg border border-gray-100 overflow-hidden">
                                                    <div className="bg-red-600 text-white px-2 py-3 flex flex-col justify-center items-center min-w-[60px]">
                                                        <span className="text-[10px] font-bold uppercase leading-tight">{product.base_unit}</span>
                                                        <span className="text-[8px] font-medium opacity-80 uppercase leading-tight">isi 1</span>
                                                    </div>
                                                    <div className="flex-1 px-3 py-2 flex flex-col justify-center">
                                                        <div className="text-[10px] text-gray-400 line-through">
                                                            {formatCurrency(oldPrice)}
                                                        </div>
                                                        <div className="text-sm font-black text-red-600">
                                                            {formatCurrency(premiumPrice)}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Bulk Unit Price */}
                                                {product.bulk_unit_name && product.bulk_unit_conversion > 1 && (
                                                    <div className="flex items-stretch bg-gray-50 rounded-lg border border-gray-100 overflow-hidden">
                                                        <div className="bg-blue-900 text-white px-2 py-3 flex flex-col justify-center items-center min-w-[60px]">
                                                            <span className="text-[10px] font-bold uppercase leading-tight">{product.bulk_unit_name}</span>
                                                            <span className="text-[8px] font-medium opacity-80 uppercase leading-tight">isi {product.bulk_unit_conversion}</span>
                                                        </div>
                                                        <div className="flex-1 px-3 py-2 flex flex-col justify-center">
                                                            <div className="text-[10px] text-gray-400 line-through">
                                                                {formatCurrency(oldPrice * product.bulk_unit_conversion)}
                                                            </div>
                                                            <div className="text-sm font-black text-red-600">
                                                                {formatCurrency(premiumPrice * product.bulk_unit_conversion)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>

                                {/* Actions */}
                                <div className="mt-auto pt-8 flex gap-2">
                                    {currentUser && (
                                        <button className="flex-1 bg-blue-900 text-white font-bold py-3 rounded-lg text-sm hover:bg-blue-800 transition shadow-sm">
                                            + Keranjang
                                        </button>
                                    )}
                                    {canEdit && (
                                        <button
                                            onClick={() => setSelectedProduct(product)}
                                            className="bg-gray-100 text-gray-600 p-3 rounded-lg hover:bg-gray-200 transition"
                                            title="Edit Produk"
                                        >
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                            </svg>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
            </div>

            {selectedProduct && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
                    <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl relative">
                        <EditProductForm
                            product={selectedProduct}
                            onClose={() => setSelectedProduct(null)}
                            onSuccess={() => {
                                setSelectedProduct(null);
                                fetchProducts();
                            }}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

export default CatalogPage;
