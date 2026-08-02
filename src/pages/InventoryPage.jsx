import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { productService } from '../services/productService';
import { inventoryService } from '../services/inventoryService';
import AddProductForm from '../components/AddProductForm';
import EditProductForm from '../components/EditProductForm';
import SetStockModal from '../components/SetStockModal';
import RepackModal from '../components/RepackModal';
import BulkPurchaseModal from '../components/BulkPurchaseModal';
import { orderService } from '../services/orderService';
import { purchaseService } from '../services/purchaseService';

import { useUserRole } from '../hooks/useUserRole';
import * as XLSX from 'xlsx';

// ... (existing imports)

const formatCurrency = (value) => {
    if (!value) return "Rp 0";
    return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value);
};

export default function InventoryPage() {
    const { isSuperAdmin, loading: roleLoading } = useUserRole();
    const [products, setProducts] = useState([]);
    const [showAddForm, setShowAddForm] = useState(false);
    const [selectedProductForEdit, setSelectedProductForEdit] = useState(null);
    const [selectedProductForStock, setSelectedProductForStock] = useState(null);
    const [showRepackForm, setShowRepackForm] = useState(false);
    const [showBulkPurchaseModal, setShowBulkPurchaseModal] = useState(() => {
        try {
            return localStorage.getItem("show_bulk_purchase_modal") === "true";
        } catch {
            return false;
        }
    });
    const [bulkPurchaseInitialItems, setBulkPurchaseInitialItems] = useState([]);

    useEffect(() => {
        localStorage.setItem("show_bulk_purchase_modal", showBulkPurchaseModal);
    }, [showBulkPurchaseModal]);

    const [loading, setLoading] = useState(true);
    const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' });
    const [openMenuId, setOpenMenuId] = useState(null);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
    const [searchQuery, setSearchQuery] = useState('');

    // Insights State
    const [orders, setOrders] = useState([]);
    const [purchases, setPurchases] = useState([]);
    const [belanjaPeriod, setBelanjaPeriod] = useState('day');
    const [pendapatanPeriod, setPendapatanPeriod] = useState('day');

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [productList, orderList, purchaseList] = await Promise.all([
                productService.getAllProducts(),
                orderService.getAllOrders(),
                isSuperAdmin ? purchaseService.getAllPurchases() : Promise.resolve([])
            ]);

            // Enhance with stock data
            const enhancedList = await Promise.all(productList.map(async (p) => {
                const stock = await inventoryService.getStock(p.id);
                return { ...p, current_stock: stock };
            }));

            setProducts(enhancedList);
            setOrders(orderList);
            if (isSuperAdmin) {
                setPurchases(purchaseList);
            }
        } catch (error) {
            console.error("Failed to load dashboard data", error);
        } finally {
            setLoading(false);
        }
    }, [isSuperAdmin]);

    useEffect(() => {
        if (!roleLoading) {
            fetchData();
        }
    }, [roleLoading, isSuperAdmin, fetchData]); // Re-fetch if role changes/loads

    // Sorting function
    const handleSort = (key) => {
        let direction = 'desc';

        // If clicking the same column, toggle direction
        if (sortConfig.key === key && sortConfig.direction === 'desc') {
            direction = 'asc';
        }

        setSortConfig({ key, direction });
    };

    // Get filtered and sorted products
    const getFilteredAndSortedProducts = () => {
        // First filter by search query using order-insensitive keywords
        let filtered = products;
        if (searchQuery) {
            const queryWords = searchQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);
            if (queryWords.length > 0) {
                filtered = products.filter(p => {
                    const nameLower = (p.name || '').toLowerCase();
                    const skuLower = (p.sku || '').toLowerCase();
                    return queryWords.every(word => nameLower.includes(word) || skuLower.includes(word));
                });
            }
        }

        if (!sortConfig.key) return filtered;

        const sorted = [...filtered].sort((a, b) => {
            let aValue, bValue;

            // Handle different column types
            switch (sortConfig.key) {
                case 'sku':
                case 'name':
                case 'base_unit':
                    aValue = (a[sortConfig.key] || '').toLowerCase();
                    bValue = (b[sortConfig.key] || '').toLowerCase();
                    break;
                case 'stock':
                    aValue = a.current_stock || 0;
                    bValue = b.current_stock || 0;
                    break;
                case 'cost_price':
                    aValue = a.cost_price || 0;
                    bValue = b.cost_price || 0;
                    break;
                case 'total_value':
                    aValue = (a.current_stock || 0) * (a.cost_price || 0);
                    bValue = (b.current_stock || 0) * (b.cost_price || 0);
                    break;
                default:
                    return 0;
            }

            // Compare values
            if (aValue < bValue) {
                return sortConfig.direction === 'asc' ? -1 : 1;
            }
            if (aValue > bValue) {
                return sortConfig.direction === 'asc' ? 1 : -1;
            }
            return 0;
        });

        return sorted;
    };

    // Sort indicator component
    const SortIndicator = ({ columnKey }) => {
        if (sortConfig.key !== columnKey) {
            return <span className="ml-1 text-gray-400">⇅</span>;
        }
        return (
            <span className="ml-1">
                {sortConfig.direction === 'asc' ? '↑' : '↓'}
            </span>
        );
    };

    // Export to Excel function
    const handleExportExcel = () => {
        try {
            // Prepare data for export
            const exportData = sortedProducts.map(product => ({
                'SKU': product.sku,
                'Nama Produk': product.name,
                'Satuan Dasar': product.base_unit,
                'Jumlah Stok': product.current_stock || 0,
                'Harga Beli (Satuan)': product.cost_price || 0,
                'Total Nilai': (product.current_stock || 0) * (product.cost_price || 0),
                'Satuan Besar': product.bulk_unit_name || '-',
                'Konversi': product.bulk_unit_conversion || '-'
            }));

            // Create worksheet
            const ws = XLSX.utils.json_to_sheet(exportData);

            // Create workbook
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Inventory");

            // Generate filename with date
            const dateStr = new Date().toISOString().split('T')[0];
            const filename = `Inventori_SDRG_${dateStr}.xlsx`;

            // Export file
            XLSX.writeFile(wb, filename);
        } catch (error) {
            console.error("Gagal mengekspor data ke Excel:", error);
            alert("Terjadi kesalahan saat mengekspor data.");
        }
    };

    const sortedProducts = getFilteredAndSortedProducts();

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = () => setOpenMenuId(null);
        if (openMenuId) {
            document.addEventListener('click', handleClickOutside);
            return () => document.removeEventListener('click', handleClickOutside);
        }
    }, [openMenuId]);

    // Handle opening the three-dot menu — calculate position from the clicked button
    const handleMenuToggle = (e, productId) => {
        e.stopPropagation();
        if (openMenuId === productId) {
            setOpenMenuId(null);
        } else {
            const rect = e.currentTarget.getBoundingClientRect();
            setMenuPos({
                top: rect.bottom + 4,
                left: rect.right - 192,
            });
            setOpenMenuId(productId);
        }
    };

    // Insight Logic
    const calculateTotal = (data, period, dateKey = 'created_at') => {
        const now = new Date();
        const startOfPeriod = new Date();

        if (period === 'day') {
            startOfPeriod.setHours(0, 0, 0, 0);
        } else if (period === 'week') {
            const day = now.getDay();
            const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
            startOfPeriod.setDate(diff);
            startOfPeriod.setHours(0, 0, 0, 0);
        } else if (period === 'month') {
            startOfPeriod.setDate(1);
            startOfPeriod.setHours(0, 0, 0, 0);
        } else if (period === 'year') {
            startOfPeriod.setMonth(0, 1);
            startOfPeriod.setHours(0, 0, 0, 0);
        }

        return data.reduce((sum, item) => {
            const itemDate = item[dateKey]?.toDate?.() || new Date(item[dateKey]);
            if (itemDate >= startOfPeriod && itemDate <= now) {
                return sum + (item.grand_total || 0);
            }
            return sum;
        }, 0);
    };

    const totalBelanja = calculateTotal(purchases.filter(purchase => purchase.status !== 'cancelled'), belanjaPeriod);
    const paidOrders = orders.filter(order =>
        order.status !== 'cancelled'
        && order.status !== 'unpaid'
        && order.payment_status !== 'unpaid'
    );
    const totalPendapatan = calculateTotal(paidOrders, pendapatanPeriod);
    const totalGudang = products.reduce((sum, p) => sum + ((p.current_stock || 0) * (p.cost_price || 0)), 0);

    const preOrderDemand = useMemo(() => {
        const demandByProduct = new Map();

        orders
            .filter(order =>
                order.status !== 'cancelled'
                && (order.payment_status === 'unpaid' || order.status === 'unpaid')
            )
            .forEach(order => {
                (order.items || []).forEach(item => {
                    const product = products.find(p => p.id === item.product_id || p.sku === item.product_id);
                    const baseUnit = item.base_unit || product?.base_unit || 'unit';
                    const baseUnitLower = baseUnit.toLowerCase().trim();
                    const bulkUnitLower = (item.bulk_unit_name || product?.bulk_unit_name || '').toLowerCase().trim();
                    const isSameUnit = baseUnitLower && bulkUnitLower && baseUnitLower === bulkUnitLower;
                    const conversion = isSameUnit
                        ? 1
                        : (Number(item.bulk_unit_conversion || product?.bulk_unit_conversion) || 1);
                    const plannedQty = (Number(item.qty) || 0) * (item.selected_unit === 'bulk' ? conversion : 1);
                    const key = item.product_id;
                    const existing = demandByProduct.get(key) || {
                        product_id: key,
                        product_name: item.product_name || product?.name || key,
                        base_unit: baseUnit,
                        planned_demand: 0,
                        on_hand: product ? (Number(product.current_stock) || 0) : null,
                        missing_product: !product,
                        target_dates: new Set(),
                        order_ids: new Set()
                    };

                    existing.planned_demand += plannedQty;
                    if (order.target_date) existing.target_dates.add(order.target_date);
                    existing.order_ids.add(order.id);
                    demandByProduct.set(key, existing);
                });
            });

        return Array.from(demandByProduct.values())
            .map(row => ({
                ...row,
                target_dates: Array.from(row.target_dates).sort(),
                order_count: row.order_ids.size,
                deficit: row.missing_product ? 0 : Math.max(0, row.planned_demand - row.on_hand)
            }))
            .sort((a, b) => b.deficit - a.deficit || a.product_name.localeCompare(b.product_name));
    }, [orders, products]);

    const deficitItems = preOrderDemand
        .filter(row => !row.missing_product && row.deficit > 0)
        .map(row => ({ product_id: row.product_id, qty: row.deficit }));

    const openBulkPurchase = () => {
        setBulkPurchaseInitialItems([]);
        setShowBulkPurchaseModal(true);
    };

    const importDemandToBulkPurchase = () => {
        setBulkPurchaseInitialItems(deficitItems);
        setShowBulkPurchaseModal(true);
    };

    const StatCard = ({ title, value, color, period, setPeriod, hidePeriods }) => (
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between min-h-[180px]">
            <div>
                <h3 className="text-gray-500 font-bold uppercase tracking-wider text-xs mb-4 text-center">{title}</h3>
                <p className={`text-3xl font-bold text-center ${color}`}>{formatCurrency(value)}</p>
            </div>
            {!hidePeriods && (
                <div className="flex justify-center gap-1 mt-6">
                    {['day', 'week', 'month', 'year'].map((p) => (
                        <button
                            key={p}
                            onClick={() => setPeriod(p)}
                            className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase transition-all ${period === p
                                ? 'bg-gray-900 text-white shadow-md'
                                : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                                }`}
                        >
                            {p === 'day' ? 'Hari' : p === 'week' ? 'Minggu' : p === 'month' ? 'Bulan' : 'Tahun'}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Inventori</h1>
                    <p className="text-sm text-gray-500 mt-1">Kelola produk dan nilai gudang</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={openBulkPurchase}
                        className="px-5 py-2.5 bg-blue-600 text-white font-bold rounded-lg shadow-sm hover:bg-blue-700 transition flex items-center gap-2 text-sm">
                        <span>📥</span> Pembelian Grosir
                    </button>
                    <button
                        onClick={() => setShowRepackForm(true)}
                        className="px-5 py-2.5 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg shadow-sm hover:bg-gray-50 transition text-sm">
                        ⇄ Kemasan Ulang / Pecah
                    </button>
                    <button
                        onClick={() => setShowAddForm(true)}
                        className="px-5 py-2.5 bg-primary text-white font-bold rounded-lg shadow-sm hover:bg-red-700 transition text-sm">
                        + Produk Baru
                    </button>
                </div>
            </div>

            {/* Insights Dashboard - Only Visible to SuperAdmin */}
            {isSuperAdmin && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <StatCard
                        title="BELANJA"
                        value={totalBelanja}
                        color="text-blue-600"
                        period={belanjaPeriod}
                        setPeriod={setBelanjaPeriod}
                    />
                    <StatCard
                        title="PENDAPATAN"
                        value={totalPendapatan}
                        color="text-green-600"
                        period={pendapatanPeriod}
                        setPeriod={setPendapatanPeriod}
                    />
                    <StatCard
                        title="TOTAL NILAI GUDANG"
                        value={totalGudang}
                        color="text-gray-900"
                        hidePeriods
                    />
                </div>
            )}

            <section className="mb-8 rounded-2xl border border-amber-200 bg-white shadow-sm overflow-hidden">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 bg-amber-50 border-b border-amber-200">
                    <div>
                        <h2 className="text-lg font-black text-amber-950">Perencanaan Pre-Order & Restock Demand</h2>
                        <p className="text-sm text-amber-800 mt-1">
                            Permintaan dari pre-order aktif dibandingkan dengan stok fisik saat ini.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={importDemandToBulkPurchase}
                        disabled={deficitItems.length === 0}
                        className="px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold shadow-sm disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed transition"
                    >
                        Impor ke Restock Bulk Purchase ({deficitItems.length})
                    </button>
                </div>

                {preOrderDemand.length === 0 ? (
                    <div className="p-8 text-center text-sm text-gray-500">
                        Belum ada pre-order aktif yang perlu direncanakan.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[760px] text-sm">
                            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600">
                                <tr>
                                    <th className="px-5 py-3 text-left">Produk</th>
                                    <th className="px-5 py-3 text-right">Planned Demand</th>
                                    <th className="px-5 py-3 text-right">On-Hand Stock</th>
                                    <th className="px-5 py-3 text-right">Defisit Stok</th>
                                    <th className="px-5 py-3 text-left">Target</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {preOrderDemand.map(row => (
                                    <tr key={row.product_id} className={row.missing_product ? 'bg-amber-50' : row.deficit > 0 ? 'bg-red-50/60' : 'bg-green-50/30'}>
                                        <td className="px-5 py-4">
                                            <div className="font-bold text-gray-900">{row.product_name}</div>
                                            <div className="text-xs text-gray-500">{row.order_count} pre-order aktif</div>
                                        </td>
                                        <td className="px-5 py-4 text-right font-semibold text-gray-900">
                                            {row.planned_demand} {row.base_unit}
                                        </td>
                                        <td className="px-5 py-4 text-right text-gray-700">
                                            {row.missing_product ? (
                                                <span className="font-semibold text-amber-700">ID produk tidak ditemukan</span>
                                            ) : `${row.on_hand} ${row.base_unit}`}
                                        </td>
                                        <td className={`px-5 py-4 text-right font-black ${row.deficit > 0 ? 'text-red-700' : 'text-green-700'}`}>
                                            {row.missing_product ? '-' : `${row.deficit} ${row.base_unit}`}
                                        </td>
                                        <td className="px-5 py-4 text-gray-600">
                                            {row.target_dates.length > 0 ? row.target_dates.join(', ') : '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {showAddForm && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="w-full max-w-2xl bg-white rounded-lg shadow-xl overflow-y-auto max-h-[90vh]">
                        <AddProductForm
                            onClose={() => setShowAddForm(false)}
                            onSuccess={(newProduct) => {
                                setShowAddForm(false);
                                fetchData();
                                // Automatically open stock adjustment for the newly created product
                                setSelectedProductForStock({ ...newProduct, current_stock: 0 });
                            }}
                        />
                    </div>
                </div>
            )}

            {selectedProductForEdit && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="w-full max-w-2xl bg-white rounded-lg shadow-xl overflow-y-auto max-h-[90vh]">
                        <EditProductForm
                            product={selectedProductForEdit}
                            onClose={() => setSelectedProductForEdit(null)}
                            onSuccess={() => { setSelectedProductForEdit(null); fetchData(); }}
                        />
                    </div>
                </div>
            )}

            {selectedProductForStock && (
                <SetStockModal
                    product={selectedProductForStock}
                    onClose={() => setSelectedProductForStock(null)}
                    onSuccess={() => { setSelectedProductForStock(null); fetchData(); }}
                />
            )}

            {showRepackForm && (
                <RepackModal
                    onClose={() => setShowRepackForm(false)}
                    onSuccess={() => { setShowRepackForm(false); fetchData(); }}
                />
            )}

            <BulkPurchaseModal
                isOpen={showBulkPurchaseModal}
                onClose={() => {
                    setShowBulkPurchaseModal(false);
                    setBulkPurchaseInitialItems([]);
                }}
                onSuccess={() => { fetchData(); }}
                products={products}
                initialItems={bulkPurchaseInitialItems}
            />

            {/* Search Bar */}
            <div className="mb-6 relative">
                <input
                    type="text"
                    placeholder="Cari Nama Produk..."
                    className="w-full p-3 pl-10 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
                <svg className="w-5 h-5 absolute left-3 top-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
            </div>

            {loading ? (
                <div className="text-center py-10 text-gray-500">Memuat inventori...</div>
            ) : products.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-lg border border-dashed border-gray-300">
                    <p className="text-gray-500 mb-2">Tidak ada produk ditemukan.</p>
                    <p className="text-sm text-gray-400">Klik "Produk Baru" untuk memulai.</p>
                </div>
            ) : sortedProducts.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-lg border border-dashed border-gray-300">
                    <p className="text-gray-500 mb-2">Tidak ada produk yang cocok dengan "{searchQuery}".</p>
                </div>
            ) : (
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                    <table className="w-full text-left text-sm text-gray-600">
                        <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th
                                    onClick={() => handleSort('name')}
                                    className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs cursor-pointer hover:bg-gray-100 transition select-none">
                                    Nama Produk <SortIndicator columnKey="name" />
                                </th>
                                <th
                                    onClick={() => handleSort('base_unit')}
                                    className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs cursor-pointer hover:bg-gray-100 transition select-none">
                                    Satuan Dasar <SortIndicator columnKey="base_unit" />
                                </th>
                                <th
                                    onClick={() => handleSort('stock')}
                                    className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs text-right cursor-pointer hover:bg-gray-100 transition select-none">
                                    Jumlah Stok <SortIndicator columnKey="stock" />
                                </th>
                                <th
                                    onClick={() => handleSort('cost_price')}
                                    className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs text-right cursor-pointer hover:bg-gray-100 transition select-none">
                                    Harga Beli <SortIndicator columnKey="cost_price" />
                                </th>
                                <th
                                    onClick={() => handleSort('total_value')}
                                    className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs text-right cursor-pointer hover:bg-gray-100 transition select-none">
                                    Total Nilai <SortIndicator columnKey="total_value" />
                                </th>
                                <th className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs text-center w-16">
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {sortedProducts.map(product => (
                                <tr 
                                    key={product.id} 
                                    className={`transition-colors ${
                                        product.needs_stock_check 
                                            ? 'bg-yellow-50 hover:bg-yellow-100/80 dark:bg-yellow-950/20 dark:hover:bg-yellow-900/30' 
                                            : 'hover:bg-gray-50'
                                    }`}
                                >
                                    <td className="px-6 py-4">{product.name}</td>
                                    <td className="px-6 py-4">{product.base_unit}</td>
                                    <td className="px-6 py-4 text-right font-bold text-gray-900">
                                        {product.current_stock || 0}
                                    </td>
                                    <td className="px-6 py-4 text-right text-gray-600">
                                        {product.cost_price ? formatCurrency(product.cost_price) : '-'}
                                    </td>
                                    <td className="px-6 py-4 text-right font-medium text-gray-900">
                                        {product.cost_price ? formatCurrency((product.current_stock || 0) * product.cost_price) : '-'}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <button
                                            onClick={(e) => handleMenuToggle(e, product.id)}
                                            className="p-2 rounded-lg hover:bg-gray-100 transition text-gray-500 hover:text-gray-700"
                                            title="Aksi"
                                        >
                                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                                            </svg>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {/* Dropdown menu rendered outside the table to avoid overflow clipping */}
                    {openMenuId && (
                        <div
                            className="fixed w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50"
                            style={{ top: menuPos.top, left: menuPos.left }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <button
                                onClick={() => { const p = products.find(p => p.id === openMenuId); setOpenMenuId(null); setSelectedProductForEdit(p); }}
                                className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                            >
                                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                                Edit Produk
                            </button>
                            <button
                                onClick={() => { const p = products.find(p => p.id === openMenuId); setOpenMenuId(null); setSelectedProductForStock(p); }}
                                className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                            >
                                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                </svg>
                                Tetapkan Stok
                            </button>
                            <button
                                onClick={async () => {
                                    const p = products.find(p => p.id === openMenuId);
                                    if (p) {
                                        setOpenMenuId(null);
                                        try {
                                            await productService.saveProduct({
                                                product_id: p.id,
                                                needs_stock_check: !p.needs_stock_check
                                            });
                                            fetchData();
                                        } catch (e) {
                                            alert("Gagal menandai produk: " + e.message);
                                        }
                                    }
                                }}
                                className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                            >
                                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                                </svg>
                                {products.find(p => p.id === openMenuId)?.needs_stock_check ? 'Hapus Tanda' : 'Tandai'}
                            </button>
                        </div>
                    )}

                    {/* Export Button Container */}
                    {isSuperAdmin && (
                        <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end">
                            <button
                                onClick={handleExportExcel}
                                className="px-4 py-2 bg-green-600 text-white font-bold rounded-lg shadow-sm hover:bg-green-700 transition flex items-center gap-2 text-sm"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                Ekspor ke Excel (.xlsx)
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
