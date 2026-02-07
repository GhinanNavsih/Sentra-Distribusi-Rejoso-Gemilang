import React, { useState, useEffect } from 'react';
import { productService } from '../services/productService';
import { inventoryService } from '../services/inventoryService';
import AddProductForm from '../components/AddProductForm';
import EditProductForm from '../components/EditProductForm';
import RepackModal from '../components/RepackModal';
import BulkPurchaseModal from '../components/BulkPurchaseModal';
import { orderService } from '../services/orderService';
import { purchaseService } from '../services/purchaseService';

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
    const [products, setProducts] = useState([]);
    const [showAddForm, setShowAddForm] = useState(false);
    const [selectedProductForEdit, setSelectedProductForEdit] = useState(null);
    const [showRepackForm, setShowRepackForm] = useState(false);
    const [showBulkPurchaseModal, setShowBulkPurchaseModal] = useState(false);
    const [loading, setLoading] = useState(true);
    const [sortConfig, setSortConfig] = useState({ key: null, direction: null });

    // Insights State
    const [orders, setOrders] = useState([]);
    const [purchases, setPurchases] = useState([]);
    const [belanjaPeriod, setBelanjaPeriod] = useState('day'); // day, week, month, year
    const [pendapatanPeriod, setPendapatanPeriod] = useState('day'); // day, week, month, year

    const fetchData = async () => {
        setLoading(true);
        try {
            const productList = await productService.getAllProducts();
            const [orderList, purchaseList] = await Promise.all([
                orderService.getAllOrders(),
                purchaseService.getAllPurchases()
            ]);

            // Enhance with stock data
            const enhancedList = await Promise.all(productList.map(async (p) => {
                const stock = await inventoryService.getStock(p.id);
                return { ...p, current_stock: stock };
            }));

            setProducts(enhancedList);
            setOrders(orderList);
            setPurchases(purchaseList);
        } catch (error) {
            console.error("Failed to load dashboard data", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    // Sorting function
    const handleSort = (key) => {
        let direction = 'asc';

        // If clicking the same column, toggle direction
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }

        setSortConfig({ key, direction });
    };

    // Get sorted products
    const getSortedProducts = () => {
        if (!sortConfig.key) return products;

        const sorted = [...products].sort((a, b) => {
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

    const sortedProducts = getSortedProducts();

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

    const totalBelanja = calculateTotal(purchases, belanjaPeriod);
    const totalPendapatan = calculateTotal(orders, pendapatanPeriod);
    const totalGudang = products.reduce((sum, p) => sum + ((p.current_stock || 0) * (p.cost_price || 0)), 0);

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
                        onClick={() => setShowBulkPurchaseModal(true)}
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

            {/* Insights Dashboard */}
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

            {showAddForm && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="w-full max-w-2xl bg-white rounded-lg shadow-xl overflow-y-auto max-h-[90vh]">
                        <AddProductForm
                            onClose={() => setShowAddForm(false)}
                            onSuccess={() => { setShowAddForm(false); fetchData(); }}
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

            {showRepackForm && (
                <RepackModal
                    onClose={() => setShowRepackForm(false)}
                    onSuccess={() => { setShowRepackForm(false); fetchData(); }}
                />
            )}

            <BulkPurchaseModal
                isOpen={showBulkPurchaseModal}
                onClose={() => setShowBulkPurchaseModal(false)}
                onSuccess={() => { fetchData(); }}
                products={products}
            />

            {loading ? (
                <div className="text-center py-10 text-gray-500">Memuat inventori...</div>
            ) : products.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-lg border border-dashed border-gray-300">
                    <p className="text-gray-500 mb-2">Tidak ada produk ditemukan.</p>
                    <p className="text-sm text-gray-400">Klik "Produk Baru" untuk memulai.</p>
                </div>
            ) : (
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                    <table className="w-full text-left text-sm text-gray-600">
                        <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th
                                    onClick={() => handleSort('sku')}
                                    className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs cursor-pointer hover:bg-gray-100 transition select-none">
                                    SKU <SortIndicator columnKey="sku" />
                                </th>
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
                                <th className="px-6 py-3 font-bold text-gray-900 uppercase tracking-wider text-xs text-right">
                                    Aksi
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {sortedProducts.map(product => (
                                <tr key={product.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-6 py-4 font-medium text-gray-900">{product.sku}</td>
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
                                    <td className="px-6 py-4 text-right">
                                        <button
                                            onClick={() => setSelectedProductForEdit(product)}
                                            className="text-gray-500 hover:text-gray-700 font-medium px-4 py-2 rounded border border-gray-200 hover:bg-gray-50 transition">
                                            Edit
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
