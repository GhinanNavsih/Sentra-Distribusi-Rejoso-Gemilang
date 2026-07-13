import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase.config';
import { collection, query, orderBy, limit, getDocs, startAfter } from 'firebase/firestore';
import { getCollectionName } from '../utils/envMode';
import { productService } from '../services/productService';
import { FaHistory, FaSearch, FaFilter, FaCalendarAlt, FaChevronDown } from 'react-icons/fa';

const LIMIT_SIZE = 50;

export default function StockMovementLogPage() {
    const [movements, setMovements] = useState([]);
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [lastDoc, setLastDoc] = useState(null);
    const [hasMore, setHasMore] = useState(false);

    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [typeFilter, setTypeFilter] = useState('all');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // Fetch products to map SKU to Product Name
    useEffect(() => {
        const loadProducts = async () => {
            try {
                const list = await productService.getAllProducts();
                setProducts(list);
            } catch (err) {
                console.error("Failed to load products:", err);
            }
        };
        loadProducts();
    }, []);

    // Load initial logs
    useEffect(() => {
        loadInitialLogs();
    }, []);

    const loadInitialLogs = async () => {
        setLoading(true);
        try {
            const colName = getCollectionName("stock_movements");
            const q = query(
                collection(db, colName),
                orderBy("created_at", "desc"),
                limit(LIMIT_SIZE)
            );
            const snapshot = await getDocs(q);
            
            const list = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    date: data.created_at?.toDate?.() || new Date(data.created_at) || new Date()
                };
            });

            setMovements(list);
            setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
            setHasMore(snapshot.docs.length === LIMIT_SIZE);
        } catch (err) {
            console.error("Failed to load stock movements:", err);
            alert("Gagal memuat log stock: " + err.message);
        } finally {
            setLoading(false);
        }
    };

    const loadMoreLogs = async () => {
        if (!lastDoc || loadingMore) return;
        setLoadingMore(true);
        try {
            const colName = getCollectionName("stock_movements");
            const q = query(
                collection(db, colName),
                orderBy("created_at", "desc"),
                startAfter(lastDoc),
                limit(LIMIT_SIZE)
            );
            const snapshot = await getDocs(q);
            
            const list = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    date: data.created_at?.toDate?.() || new Date(data.created_at) || new Date()
                };
            });

            setMovements(prev => [...prev, ...list]);
            setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
            setHasMore(snapshot.docs.length === LIMIT_SIZE);
        } catch (err) {
            console.error("Failed to load more stock movements:", err);
        } finally {
            setLoadingMore(false);
        }
    };

    // Helper: Map SKU to product name
    const getProductName = (sku) => {
        const prod = products.find(p => p.sku === sku);
        return prod ? prod.name : sku;
    };

    // Helper: Format Action Badges
    const getBadgeStyle = (type) => {
        switch (type) {
            case 'sale_created':
                return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200';
            case 'sale_updated':
                return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 border-yellow-200';
            case 'sale_cancelled':
                return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border-red-200';
            case 'purchase_created':
                return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 border-green-200';
            case 'purchase_updated':
                return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 border-yellow-200';
            case 'purchase_cancelled':
                return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border-red-200';
            case 'repack_source':
                return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border-purple-200';
            case 'repack_target':
                return 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300 border-pink-200';
            case 'stock_adjusted':
                return 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-300 border-slate-200';
            case 'stock_deleted':
                return 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300 border-gray-200';
            default:
                return 'bg-gray-50 text-gray-600 dark:bg-gray-900/20 dark:text-gray-400 border-gray-100';
        }
    };

    const getBadgeLabel = (type) => {
        switch (type) {
            case 'sale_created': return 'Penjualan Baru';
            case 'sale_updated': return 'Edit Penjualan';
            case 'sale_cancelled': return 'Batal Penjualan';
            case 'purchase_created': return 'Pembelian Baru';
            case 'purchase_updated': return 'Edit Pembelian';
            case 'purchase_cancelled': return 'Batal Pembelian';
            case 'repack_source': return 'Repack (Bahan)';
            case 'repack_target': return 'Repack (Hasil)';
            case 'stock_adjusted': return 'Edit Stok Manual';
            case 'stock_deleted': return 'Hapus Stok';
            default: return type || 'Log Stok';
        }
    };

    // Client-side filtering & formatting
    const filteredMovements = useMemo(() => {
        return movements.filter(m => {
            // 1. Search filter
            const pName = getProductName(m.product_id).toLowerCase();
            const sku = (m.product_id || '').toLowerCase();
            const txId = (m.transaction_id || '').toLowerCase();
            const cleanSearch = searchTerm.toLowerCase();
            const matchesSearch = pName.includes(cleanSearch) || sku.includes(cleanSearch) || txId.includes(cleanSearch);

            // 2. Type filter
            let matchesType = true;
            if (typeFilter !== 'all') {
                if (typeFilter === 'sales') {
                    matchesType = m.transaction_type?.startsWith('sale');
                } else if (typeFilter === 'purchases') {
                    matchesType = m.transaction_type?.startsWith('purchase');
                } else if (typeFilter === 'repack') {
                    matchesType = m.transaction_type?.startsWith('repack');
                } else if (typeFilter === 'manual') {
                    matchesType = m.transaction_type === 'stock_adjusted' || m.transaction_type === 'stock_deleted';
                }
            }

            // 3. Date range filter
            let matchesDate = true;
            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                matchesDate = matchesDate && m.date >= start;
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                matchesDate = matchesDate && m.date <= end;
            }

            return matchesSearch && matchesType && matchesDate;
        });
    }, [movements, products, searchTerm, typeFilter, startDate, endDate]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                    <FaHistory className="text-primary text-2xl sm:text-3xl" /> Log Pergerakan Stok
                </h1>
                <p className="text-sm text-gray-500 mt-1">Audit log otomatis untuk setiap perubahan jumlah stok barang</p>
            </div>

            {/* Filter controls */}
            <div className="bg-white dark:bg-gray-800 p-5 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    {/* Search */}
                    <div className="relative">
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Cari Produk / ID Transaksi</label>
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Cari nama, SKU, atau ID..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg pl-9 pr-3 py-2 text-sm bg-white dark:bg-gray-700 outline-none focus:ring-2 focus:ring-primary focus:border-transparent dark:text-white transition"
                            />
                            <FaSearch className="absolute left-3 top-3 text-gray-400 text-xs" />
                        </div>
                    </div>

                    {/* Filter Type */}
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Tipe Aktivitas</label>
                        <div className="relative">
                            <select
                                value={typeFilter}
                                onChange={(e) => setTypeFilter(e.target.value)}
                                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 outline-none focus:ring-2 focus:ring-primary focus:border-transparent dark:text-white appearance-none cursor-pointer transition"
                            >
                                <option value="all">Semua Tipe</option>
                                <option value="sales">Penjualan</option>
                                <option value="purchases">Pembelian / Terima</option>
                                <option value="repack">Repack</option>
                                <option value="manual">Penyesuaian Manual</option>
                            </select>
                            <FaFilter className="absolute right-3 top-3.5 text-gray-400 text-[10px] pointer-events-none" />
                        </div>
                    </div>

                    {/* Start Date */}
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Mulai Tanggal</label>
                        <div className="relative">
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 outline-none focus:ring-2 focus:ring-primary focus:border-transparent dark:text-white transition cursor-pointer"
                            />
                        </div>
                    </div>

                    {/* End Date */}
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Sampai Tanggal</label>
                        <div className="relative">
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 outline-none focus:ring-2 focus:ring-primary focus:border-transparent dark:text-white transition cursor-pointer"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* List Table */}
            {loading ? (
                <div className="flex justify-center items-center h-64 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
                    <p className="text-gray-500 dark:text-gray-400 text-sm animate-pulse">Memuat log pergerakan stok...</p>
                </div>
            ) : filteredMovements.length === 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-12 text-center shadow-sm">
                    <FaCalendarAlt size={48} className="mx-auto text-gray-300 dark:text-gray-600 mb-4" />
                    <p className="text-gray-500 dark:text-gray-400 text-sm">Tidak ada log pergerakan stok yang cocok dengan kriteria filter.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-left">
                                <thead className="bg-gray-50 dark:bg-gray-900/60 text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                    <tr>
                                        <th className="px-6 py-4">Waktu</th>
                                        <th className="px-6 py-4">Produk (SKU)</th>
                                        <th className="px-6 py-4">Tipe Aktivitas</th>
                                        <th className="px-6 py-4">ID Transaksi</th>
                                        <th className="px-6 py-4 text-center">Selisih</th>
                                        <th className="px-6 py-4 text-center">Sebelum</th>
                                        <th className="px-6 py-4 text-center">Sesudah</th>
                                        <th className="px-6 py-4">Operator</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-sm text-gray-700 dark:text-gray-300">
                                    {filteredMovements.map((m) => {
                                        const dateStr = m.date.toLocaleDateString('id-ID', {
                                            day: '2-digit', month: 'short', year: 'numeric'
                                        }) + ' ' + m.date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

                                        const change = Number(m.change_qty || 0);

                                        return (
                                            <tr key={m.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-900/20 transition-colors">
                                                <td className="px-6 py-4 font-medium whitespace-nowrap text-gray-500 dark:text-gray-400 text-xs">
                                                    {dateStr}
                                                </td>
                                                <td className="px-6 py-4 max-w-[200px] truncate">
                                                    <p className="font-semibold text-gray-900 dark:text-white truncate">{getProductName(m.product_id)}</p>
                                                    <p className="text-xs text-gray-400 font-mono mt-0.5">{m.product_id}</p>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border ${getBadgeStyle(m.transaction_type)}`}>
                                                        {getBadgeLabel(m.transaction_type)}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 font-mono text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                                                    {m.transaction_id || '-'}
                                                </td>
                                                <td className={`px-6 py-4 text-center font-bold whitespace-nowrap ${change > 0 ? 'text-green-600 dark:text-green-400' : change < 0 ? 'text-red-500 dark:text-red-400' : 'text-gray-400'}`}>
                                                    {change > 0 ? `+${change}` : change}
                                                </td>
                                                <td className="px-6 py-4 text-center text-gray-500 dark:text-gray-400 font-medium">
                                                    {m.stock_before ?? '-'}
                                                </td>
                                                <td className="px-6 py-4 text-center text-gray-900 dark:text-white font-bold">
                                                    {m.stock_after ?? '-'}
                                                </td>
                                                <td className="px-6 py-4 text-xs font-semibold text-gray-500 dark:text-gray-400 truncate max-w-[150px]" title={m.operator}>
                                                    {m.operator || 'system'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Pagination - Load More */}
                    {hasMore && (
                        <div className="flex justify-center pt-2">
                            <button
                                onClick={loadMoreLogs}
                                disabled={loadingMore}
                                className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-5 py-2.5 rounded-lg text-sm font-bold hover:bg-gray-50 dark:hover:bg-gray-700 transition shadow-sm cursor-pointer disabled:opacity-50"
                            >
                                {loadingMore ? "Memuat..." : "Tampilkan Lebih Banyak"}
                                {!loadingMore && <FaChevronDown className="text-xs text-gray-400" />}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
