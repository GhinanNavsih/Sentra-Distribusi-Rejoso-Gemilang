import React, { useEffect, useState } from 'react';
import { productService, PRODUCT_CATEGORIES } from '../services/productService';
import { inventoryService } from '../services/inventoryService';
import { useAuth } from '../context/AuthContext';
import { useUserRole } from '../hooks/useUserRole';
import EditProductForm from '../components/EditProductForm';

const formatCurrency = (value) => {
    if (!value) return 'Rp 0';
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value);
};

const formatQuantity = (value) => new Intl.NumberFormat('id-ID', {
    maximumFractionDigits: 2,
}).format(Number(value) || 0);

const getStockPresentation = (stock) => {
    if (stock === null || stock === undefined) {
        return {
            label: 'Stok tidak tersedia',
            detail: 'Coba lagi nanti',
            className: 'border-gray-200 bg-gray-50 text-gray-500',
            dotClassName: 'bg-gray-400',
        };
    }
    if (stock <= 0) {
        return {
            label: 'Stok habis',
            detail: 'Tidak tersedia',
            className: 'border-red-200 bg-red-50 text-red-700',
            dotClassName: 'bg-red-500',
        };
    }
    if (stock <= 5) {
        return {
            label: 'Stok menipis',
            detail: 'Segera pesan',
            className: 'border-amber-200 bg-amber-50 text-amber-700',
            dotClassName: 'bg-amber-500',
        };
    }
    return {
        label: 'Stok tersedia',
        detail: 'Siap dipesan',
        className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        dotClassName: 'bg-emerald-500',
    };
};

const CatalogPage = () => {
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const { currentUser } = useAuth();
    const { isSuperAdmin, isShopper } = useUserRole();
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [selectedCategory, setSelectedCategory] = useState('Semua');

    const fetchProducts = async () => {
        setLoading(true);
        try {
            const data = await productService.getAllProducts();
            let stockByProduct = new Map();
            let stockReadFailed = false;

            try {
                stockByProduct = await inventoryService.getAllStock();
            } catch (stockError) {
                stockReadFailed = true;
                console.error('Failed to fetch catalog stock:', stockError);
            }

            const sortedData = [...data]
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                .map(product => ({
                    ...product,
                    current_stock: stockReadFailed
                        ? null
                        : (stockByProduct.get(product.id) ?? 0),
                }));
            setProducts(sortedData);
        } catch (error) {
            console.error('Failed to fetch products:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchProducts();
    }, []);

    const canEdit = isSuperAdmin || isShopper;
    const visibleProducts = products.filter(product => (
        selectedCategory === 'Semua' || product.category === selectedCategory
    ));

    if (loading) {
        return (
            <div className="flex min-h-[60vh] items-center justify-center">
                <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-primary" />
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-primary">Sentra Distribusi</p>
                    <h1 className="text-3xl font-black tracking-tight text-gray-900 sm:text-4xl">Katalog Produk</h1>
                    <p className="mt-2 max-w-2xl text-sm text-gray-500 sm:text-base">
                        Harga terbaik untuk kebutuhan bisnis Anda, dengan ketersediaan stok terkini.
                    </p>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm">
                    <span className="font-black text-gray-900">{visibleProducts.length}</span>
                    <span className="ml-1 text-gray-500">produk ditampilkan</span>
                </div>
            </div>

            <div className="mb-8 flex gap-2 overflow-x-auto border-b border-gray-200 pb-4" role="tablist" aria-label="Kategori produk">
                <button
                    type="button"
                    onClick={() => setSelectedCategory('Semua')}
                    className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold transition-all ${selectedCategory === 'Semua'
                        ? 'bg-primary text-white shadow-md shadow-orange-200'
                        : 'border border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50'}`}
                >
                    Semua Produk
                </button>
                {PRODUCT_CATEGORIES.map(category => (
                    <button
                        type="button"
                        key={category}
                        onClick={() => setSelectedCategory(category)}
                        className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold transition-all ${selectedCategory === category
                            ? 'bg-primary text-white shadow-md shadow-orange-200'
                            : 'border border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50'}`}
                    >
                        {category}
                    </button>
                ))}
            </div>

            {visibleProducts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center text-gray-500">
                    Tidak ada produk dalam kategori ini.
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 lg:gap-6">
                    {visibleProducts.map(product => {
                        const stockPresentation = getStockPresentation(product.current_stock);
                        const premiumPrice = product.price_premium || product.price_regular;
                        const oldPrice = product.price_regular > premiumPrice
                            ? product.price_regular
                            : Math.floor(product.price_regular * 1.05);
                        const isOutOfStock = product.current_stock !== null && product.current_stock <= 0;

                        return (
                            <div
                                key={product.id || product.sku}
                                className="group relative flex min-h-[440px] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-xl"
                            >
                                <div className="absolute left-0 top-0 z-10 rounded-br-xl bg-primary px-3 py-1 text-[9px] font-black uppercase tracking-wide text-white shadow-sm">
                                    Mau Lebih Untung?
                                </div>

                                <div className="relative aspect-square w-full overflow-hidden bg-gradient-to-br from-slate-50 via-white to-orange-50/40 p-5">
                                    <div className={`absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-bold ${stockPresentation.className}`}>
                                        <span className={`h-1.5 w-1.5 rounded-full ${stockPresentation.dotClassName}`} />
                                        {stockPresentation.label}
                                    </div>

                                    {product.image_url ? (
                                        <img
                                            src={productService.transformDriveUrl(product.image_url)}
                                            alt={product.name}
                                            className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-105"
                                            referrerPolicy="no-referrer"
                                            onError={event => {
                                                event.currentTarget.src = 'https://placehold.co/400x400?text=No+Image';
                                            }}
                                        />
                                    ) : (
                                        <div className="flex h-full flex-col items-center justify-center text-gray-300">
                                            <svg className="h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                            </svg>
                                            <span className="mt-2 text-[10px] font-bold uppercase tracking-widest">{product.base_unit}</span>
                                        </div>
                                    )}
                                </div>

                                <div className="flex flex-1 flex-col p-4">
                                    <div className="min-h-[3.5rem]">
                                        <div className="mb-1 truncate text-[10px] font-bold uppercase tracking-wider text-gray-400">
                                            {product.category || 'Produk'} · {product.sku}
                                        </div>
                                        <h3 className="line-clamp-2 text-sm font-black uppercase leading-snug tracking-tight text-gray-900">
                                            {product.name}
                                        </h3>
                                    </div>

                                    <div className={`mt-3 flex items-center justify-between rounded-xl border px-3 py-2.5 ${stockPresentation.className}`}>
                                        <div>
                                            <div className="text-[9px] font-black uppercase tracking-wider">Stok tersedia</div>
                                            <div className="mt-0.5 text-[10px] opacity-80">{stockPresentation.detail}</div>
                                        </div>
                                        <div className="text-right text-base font-black">
                                            {product.current_stock === null ? '—' : formatQuantity(product.current_stock)}
                                            <span className="ml-1 text-[10px] font-bold uppercase">{product.base_unit}</span>
                                        </div>
                                    </div>

                                    <div className="mt-3 space-y-2">
                                        <div className="flex items-stretch overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                                            <div className="flex min-w-[52px] flex-col items-center justify-center bg-primary px-1.5 py-2 text-white">
                                                <span className="text-[9px] font-black uppercase leading-tight">{product.base_unit}</span>
                                                <span className="text-[7px] font-medium uppercase leading-tight opacity-80">isi 1</span>
                                            </div>
                                            <div className="flex flex-1 flex-col justify-center px-3 py-1.5">
                                                <div className="text-[9px] text-gray-400 line-through">{formatCurrency(oldPrice)}</div>
                                                <div className="text-sm font-black text-primary">{formatCurrency(premiumPrice)}</div>
                                            </div>
                                        </div>

                                        {product.bulk_unit_name && product.bulk_unit_conversion > 1 && (
                                            <div className="flex items-stretch overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                                                <div className="flex min-w-[52px] flex-col items-center justify-center bg-blue-900 px-1.5 py-2 text-white">
                                                    <span className="text-[9px] font-black uppercase leading-tight">{product.bulk_unit_name}</span>
                                                    <span className="text-[7px] font-medium uppercase leading-tight opacity-80">isi {product.bulk_unit_conversion}</span>
                                                </div>
                                                <div className="flex flex-1 flex-col justify-center px-3 py-1.5">
                                                    <div className="text-[9px] text-gray-400 line-through">{formatCurrency(oldPrice * product.bulk_unit_conversion)}</div>
                                                    <div className="text-sm font-black text-primary">{formatCurrency(premiumPrice * product.bulk_unit_conversion)}</div>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="mt-auto flex gap-2 pt-4">
                                        {currentUser && (
                                            <button
                                                type="button"
                                                disabled={isOutOfStock}
                                                className={`flex-1 rounded-xl py-2.5 text-xs font-black transition shadow-sm ${isOutOfStock
                                                    ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                                                    : 'bg-blue-900 text-white hover:bg-blue-800'}`}
                                            >
                                                {isOutOfStock ? 'Stok Habis' : '+ Keranjang'}
                                            </button>
                                        )}
                                        {canEdit && (
                                            <button
                                                type="button"
                                                onClick={() => setSelectedProduct(product)}
                                                className="rounded-xl bg-gray-100 p-2.5 text-gray-600 transition hover:bg-gray-200"
                                                title="Edit Produk"
                                            >
                                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {selectedProduct && (
                <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
                    <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
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
