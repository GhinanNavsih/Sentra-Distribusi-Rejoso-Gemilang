import React, { useState, useEffect, useMemo } from 'react';
import { productService } from '../services/productService';
import { inventoryService } from '../services/inventoryService';
import { orderService } from '../services/orderService';
import ReceiptModal from '../components/ReceiptModal';

export default function PosPage() {
    const [products, setProducts] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [cart, setCart] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [showReceiptModal, setShowReceiptModal] = useState(false);
    const [completedOrderData, setCompletedOrderData] = useState(null);
    const [selectedCustomerType, setSelectedCustomerType] = useState('regular'); // Single selection - what gets saved

    // Load Catalog
    useEffect(() => {
        const load = async () => {
            const list = await productService.getAllProducts();
            // Get stock for each to prevent overselling (optional visual cue)
            const listWithStock = await Promise.all(list.map(async p => {
                const stock = await inventoryService.getStock(p.id);
                return { ...p, stock };
            }));
            setProducts(listWithStock);
            setLoading(false);
        };
        load();
    }, []);

    // Recalculate prices when customer type changes
    useEffect(() => {
        setCart(prev => prev.map(item => {
            const newPrice = productService.calculatePrice(item.product_obj, selectedCustomerType);
            return {
                ...item,
                unit_price: newPrice,
                total: newPrice * item.qty
            };
        }));
    }, [selectedCustomerType]);

    // Filter products
    const filteredProducts = useMemo(() => {
        if (!searchQuery) return products; // Return all if no query
        const lower = searchQuery.toLowerCase();
        return products.filter(p => p.name.toLowerCase().includes(lower) || p.sku.toLowerCase().includes(lower));
    }, [products, searchQuery]);

    // Add to cart
    const addToCart = (product) => {
        setCart(prev => {
            const existing = prev.find(item => item.product_id === product.id);
            if (existing) {
                return updateCartItemQty(prev, product.id, existing.qty + 1);
            }
            const initialQty = 1;
            const price = productService.calculatePrice(product, selectedCustomerType);
            return [...prev, {
                product_id: product.id,
                product_name: product.name,
                sku: product.sku,
                base_unit: product.base_unit,
                product_obj: product, // Store ref for recalculation
                qty: initialQty,
                unit_price: price,
                total: price * initialQty
            }];
        });
        setSearchQuery(''); // Clear search after adding
    };

    // Update logic
    const updateCartItemQty = (currentCart, productId, newQty) => {
        return currentCart.map(item => {
            if (item.product_id === productId) {
                const safeQty = Math.max(1, newQty);
                // Recalculate Tiered Price
                const newPrice = productService.calculatePrice(item.product_obj, selectedCustomerType);
                return {
                    ...item,
                    qty: safeQty,
                    unit_price: newPrice,
                    total: newPrice * safeQty
                };
            }
            return item;
        });
    };

    const handleQtyChange = (productId, val) => {
        setCart(prev => updateCartItemQty(prev, productId, parseInt(val) || 0));
    };

    const removeFromCart = (productId) => {
        setCart(prev => prev.filter(item => item.product_id !== productId));
    };

    const cartTotal = cart.reduce((sum, item) => sum + item.total, 0);

    const handleSubmitOrder = async () => {
        if (cart.length === 0) return;
        if (!confirm(`Konfirmasi pesanan dengan Total: Rp ${cartTotal.toLocaleString('id-ID')}?`)) return;

        setProcessing(true);
        try {
            const orderPayload = {
                // eslint-disable-next-line no-unused-vars
                items: cart.map(({ product_obj: _product_obj, ...rest }) => rest), // Remove object ref
                grand_total: cartTotal
            };

            await orderService.createOrder(orderPayload);

            // Prepare receipt data
            const orderDate = new Date().toLocaleDateString('id-ID', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });

            // Generate order ID (same format as in orderService)
            const d = new Date();
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = String(d.getFullYear()).slice(-2);
            const dateStr = `${day}-${month}-${year}`;

            // We don't have the exact counter, but we can use timestamp for display
            const timeStr = String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
            const orderId = `${dateStr}-${timeStr}`;

            setCompletedOrderData({
                orderId,
                orderDate,
                // Keep product_obj for receipt generation (but won't be saved to DB)
                items: cart.map(item => ({
                    product_id: item.product_id,
                    product_name: item.product_name,
                    sku: item.sku,
                    base_unit: item.base_unit,
                    qty: item.qty,
                    unit_price: item.unit_price,
                    total: item.total,
                    product_obj: item.product_obj // Keep this for receipt price recalculation
                })),
                grandTotal: cartTotal,
                selectedCustomerType: selectedCustomerType // This is what gets saved to database
            });

            setCart([]);
            setShowReceiptModal(true);
        } catch (err) {
            alert("Pesanan Gagal: " + err.message);
        } finally {
            setProcessing(false);
        }
    };

    return (
        <div className="flex h-[calc(100vh-80px)] gap-6 p-6">
            {/* Left: Product Search & Catalog */}
            <div className="flex-1 flex flex-col gap-4">
                <div className="relative">
                    <input
                        autoFocus
                        type="text"
                        placeholder="Cari Produk berdasarkan Nama atau SKU... (Mulai ketik)"
                        className="w-full p-4 pl-12 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-primary focus:border-primary text-lg"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                    <svg className="w-6 h-6 absolute left-4 top-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                </div>

                <div className="flex-1 overflow-y-auto bg-white rounded-lg border border-gray-200 shadow-sm p-4">
                    {loading ? (
                        <div className="text-gray-400 text-center mt-10">Memuat katalog...</div>
                    ) : filteredProducts.length === 0 ? (
                        <div className="text-gray-500 text-center mt-10">Tidak ada produk yang cocok dengan "{searchQuery}"</div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {filteredProducts.map(p => (
                                <button
                                    key={p.id}
                                    onClick={() => addToCart(p)}
                                    className="text-left p-4 rounded border border-gray-200 hover:border-primary hover:bg-gray-50 transition-all group"
                                >
                                    <div className="font-bold text-gray-900 group-hover:text-primary">{p.name}</div>
                                    <div className="text-xs text-gray-500 mb-2">SKU: {p.sku}</div>
                                    <div className="flex justify-between items-end">
                                        <div className="text-sm font-bold text-gray-700">
                                            Stok: {p.stock} {p.base_unit}
                                        </div>
                                        <div className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs">
                                            + Tambah
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Right: Cart */}
            <div className="w-1/3 bg-white rounded-lg border border-gray-200 shadow-sm flex flex-col">
                <div className="p-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
                    <h2 className="text-lg font-bold text-gray-900 mb-2">Pesanan Saat Ini</h2>
                    {/* Customer Type Selector - Single Select (for pricing & database) */}
                    <div className="space-y-2">
                        <p className="text-xs text-gray-500 font-medium">Pilih Tingkat Harga (disimpan ke database):</p>
                        <div className="flex gap-2">
                            {['regular', 'premium', 'star'].map(type => {
                                const isSelected = selectedCustomerType === type;
                                const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
                                return (
                                    <button
                                        key={type}
                                        onClick={() => setSelectedCustomerType(type)}
                                        className={`flex-1 py-2 px-3 text-sm font-medium rounded-md border-2 transition-all ${isSelected
                                            ? type === 'star'
                                                ? 'bg-purple-500 text-white border-purple-600 shadow-md'
                                                : type === 'premium'
                                                    ? 'bg-yellow-500 text-white border-yellow-600 shadow-md'
                                                    : 'bg-blue-500 text-white border-blue-600 shadow-md'
                                            : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                                            }`}
                                    >
                                        <div className="flex items-center justify-center gap-1">
                                            {isSelected && <span>●</span>}
                                            <span>{typeLabel}</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                        <p className="text-xs text-gray-400 italic">
                            Harga saat ini: {selectedCustomerType === 'star' ? 'Bintang (Termurah)' : selectedCustomerType === 'premium' ? 'Premium' : 'Reguler (Tertinggi)'}
                        </p>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {cart.length === 0 ? (
                        <div className="text-center text-gray-400 py-10 italic">Keranjang kosong</div>
                    ) : (
                        cart.map(item => (
                            <div key={item.product_id} className="flex gap-3 items-start border-b border-gray-100 pb-3">
                                <div className="flex-1">
                                    <div className="font-bold text-gray-900">{item.product_name}</div>
                                    <div className="text-xs text-blue-600 font-medium">
                                        @ Rp {item.unit_price.toLocaleString('id-ID')} / {item.base_unit}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        min="1"
                                        className="w-16 p-1 border border-gray-300 rounded text-center font-bold text-sm"
                                        value={item.qty}
                                        onChange={(e) => handleQtyChange(item.product_id, e.target.value)}
                                    />
                                    <div className="text-right w-24">
                                        <div className="font-bold text-gray-900">
                                            Rp {item.total.toLocaleString('id-ID')}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => removeFromCart(item.product_id)}
                                        className="text-red-400 hover:text-red-600 p-1"
                                    >
                                        &times;
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="p-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
                    <div className="flex justify-between items-center mb-4">
                        <span className="text-gray-500 font-medium">Total Keseluruhan</span>
                        <span className="text-2xl font-bold text-gray-900">Rp {cartTotal.toLocaleString('id-ID')}</span>
                    </div>
                    <button
                        disabled={cart.length === 0 || processing}
                        onClick={handleSubmitOrder}
                        className="w-full py-3 bg-primary hover:bg-red-700 text-white rounded-lg font-bold shadow-md disabled:opacity-50 disabled:cursor-not-allowed text-lg"
                    >
                        {processing ? 'Memproses...' : 'Selesaikan Pesanan'}
                    </button>
                </div>
            </div>

            {/* Receipt Modal */}
            <ReceiptModal
                isOpen={showReceiptModal}
                onClose={() => setShowReceiptModal(false)}
                orderData={completedOrderData}
            />
        </div>
    );
}
