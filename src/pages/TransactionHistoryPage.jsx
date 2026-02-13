import React, { useState, useMemo } from 'react';
import { orderService } from '../services/orderService';
import { purchaseService } from '../services/purchaseService';
import { FaShoppingCart, FaTruck, FaChevronDown, FaChevronUp, FaCalendar, FaPrint, FaFileAlt } from 'react-icons/fa';
import { printReceipt } from '../utils/standardReceiptGenerator';
import { useUserRole } from '../hooks/useUserRole';

const TransactionHistoryPage = () => {
    const { isSuperAdmin } = useUserRole();
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const today = new Date().toLocaleDateString('en-CA');
    const [startDate, setStartDate] = useState(today);
    const [endDate, setEndDate] = useState(today);
    const [filter, setFilter] = useState('all'); // 'all', 'sales', 'purchases'
    const [expandedDates, setExpandedDates] = useState({});

    // Removed useEffect for initial fetch

    const handleSearch = async () => {
        if (!startDate || !endDate) {
            alert('Silakan pilih tanggal mulai dan akhir');
            return;
        }

        setLoading(true);
        setHasSearched(true);
        try {
            const [orders, purchases] = await Promise.all([
                orderService.getAllOrders(),
                purchaseService.getAllPurchases()
            ]);

            // Combine and format transactions
            let allTransactions = [
                ...orders.map(order => ({
                    ...order,
                    type: 'sale',
                    date: order.created_at?.toDate?.() || new Date(),
                    total: order.grand_total || 0
                })),
                ...purchases.map(purchase => ({
                    ...purchase,
                    type: 'purchase',
                    date: purchase.created_at?.toDate?.() || new Date(),
                    total: purchase.grand_total || 0
                }))
            ];

            // Date Range Filter
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);

            allTransactions = allTransactions.filter(t => t.date >= start && t.date <= end);

            // Sort by date descending
            allTransactions.sort((a, b) => b.date - a.date);

            setTransactions(allTransactions);
        } catch (error) {
            console.error('Error fetching transactions:', error);
            alert('Gagal memuat riwayat transaksi');
        } finally {
            setLoading(false);
        }
    };

    // Group transactions by date
    const groupedTransactions = transactions.reduce((groups, transaction) => {
        if (filter !== 'all' && transaction.type !== filter) return groups;

        const dateKey = transaction.date.toLocaleDateString('id-ID', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        if (!groups[dateKey]) {
            groups[dateKey] = [];
        }
        groups[dateKey].push(transaction);
        return groups;
    }, {});

    const toggleDate = (dateKey) => {
        setExpandedDates(prev => ({
            ...prev,
            [dateKey]: !prev[dateKey]
        }));
    };

    // Calculate Summary Stats
    const stats = useMemo(() => {
        let totalSales = 0;
        let totalPurchases = 0;
        let totalProfit = 0;

        transactions.forEach(t => {
            if (filter !== 'all' && t.type !== filter) return;

            if (t.type === 'sale') {
                totalSales += t.total;
                if (isSuperAdmin) {
                    const profit = t.items?.reduce((sum, item) => {
                        const getEffectiveBuyPrice = (it) => {
                            if (!it.buy_price) return 0;
                            if (it.selected_unit === 'bulk' && it.bulk_unit_conversion) {
                                if (it.buy_price < (it.unit_price / 1.5)) {
                                    return it.buy_price * it.bulk_unit_conversion;
                                }
                            }
                            return it.buy_price;
                        };
                        const eBuyPrice = getEffectiveBuyPrice(item);
                        const p = eBuyPrice ? (item.unit_price - eBuyPrice) * item.qty : 0;
                        return sum + p;
                    }, 0) || 0;
                    totalProfit += profit;
                }
            } else if (t.type === 'purchase') {
                totalPurchases += t.total;
            }
        });

        return { totalSales, totalPurchases, totalProfit };
    }, [transactions, filter, isSuperAdmin]);

    const formatCurrency = (value) => {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(value);
    };

    const formatTime = (date) => {
        return date.toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // Removed initial loading state rendering

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Riwayat Transaksi</h1>
                    <p className="text-sm text-gray-500 mt-1">Pilih rentang tanggal untuk melihat transaksi</p>
                </div>

                {/* Filter Buttons */}
                {hasSearched && (
                    <div className="flex gap-2 bg-gray-100 p-1 rounded-lg">
                        <button
                            onClick={() => setFilter('all')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition ${filter === 'all'
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-600 hover:text-gray-900'
                                }`}
                        >
                            Semua
                        </button>
                        <button
                            onClick={() => setFilter('sale')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition flex items-center gap-2 ${filter === 'sale'
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-600 hover:text-gray-900'
                                }`}
                        >
                            <FaShoppingCart size={14} />
                            Penjualan
                        </button>
                        <button
                            onClick={() => setFilter('purchase')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition flex items-center gap-2 ${filter === 'purchase'
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-600 hover:text-gray-900'
                                }`}
                        >
                            <FaTruck size={14} />
                            Pembelian
                        </button>
                    </div>
                )}
            </div>

            {/* Date Picker Controls */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Tanggal Mulai</label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Tanggal Akhir</label>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <button
                        onClick={handleSearch}
                        disabled={loading}
                        className="w-full bg-blue-600 text-white font-bold py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                    >
                        {loading ? 'Mencari...' : 'Tampilkan Riwayat'}
                    </button>
                </div>
            </div>

            {/* Summary Analytics Widget */}
            {hasSearched && !loading && transactions.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white p-5 rounded-lg shadow-sm border border-blue-100 flex items-center gap-4">
                        <div className="bg-blue-50 p-3 rounded-full text-blue-600">
                            <FaShoppingCart size={24} />
                        </div>
                        <div>
                            <p className="text-xs font-bold text-blue-600 uppercase tracking-wider">Total Penjualan</p>
                            <p className="text-xl font-black text-gray-900">{formatCurrency(stats.totalSales)}</p>
                        </div>
                    </div>

                    <div className="bg-white p-5 rounded-lg shadow-sm border border-orange-100 flex items-center gap-4">
                        <div className="bg-orange-50 p-3 rounded-full text-orange-600">
                            <FaTruck size={24} />
                        </div>
                        <div>
                            <p className="text-xs font-bold text-orange-600 uppercase tracking-wider">Total Pembelian</p>
                            <p className="text-xl font-black text-gray-900">{formatCurrency(stats.totalPurchases)}</p>
                        </div>
                    </div>

                    {isSuperAdmin && (
                        <div className="bg-white p-5 rounded-lg shadow-sm border border-green-100 flex items-center gap-4">
                            <div className="bg-green-50 p-3 rounded-full text-green-600">
                                <FaFileAlt size={24} />
                            </div>
                            <div>
                                <p className="text-xs font-bold text-green-600 uppercase tracking-wider">Estimasi Keuntungan</p>
                                <p className="text-xl font-black text-gray-900">{formatCurrency(stats.totalProfit)}</p>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Content Section */}
            {!hasSearched ? (
                <div className="bg-gray-50 rounded-lg border border-dashed border-gray-300 p-12 text-center">
                    <FaCalendar size={48} className="mx-auto text-gray-300 mb-4" />
                    <p className="text-gray-500">Silakan pilih rentang tanggal dan klik "Tampilkan Riwayat" untuk melihat catatan.</p>
                </div>
            ) : loading ? (
                <div className="flex items-center justify-center h-64">
                    <div className="text-gray-500">Memuat transaksi...</div>
                </div>
            ) : Object.keys(groupedTransactions).length === 0 ? (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
                    <div className="text-gray-400 mb-2">
                        <FaCalendar size={48} className="mx-auto" />
                    </div>
                    <p className="text-gray-500">Tidak ada transaksi ditemukan untuk periode yang dipilih.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {Object.entries(groupedTransactions).map(([dateKey, dayTransactions]) => {
                        const isExpanded = expandedDates[dateKey] !== false; // Default expanded
                        const dayTotal = dayTransactions.reduce((sum, t) => sum + t.total, 0);
                        const salesCount = dayTransactions.filter(t => t.type === 'sale').length;
                        const purchasesCount = dayTransactions.filter(t => t.type === 'purchase').length;

                        return (
                            <div key={dateKey} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                                {/* Date Header */}
                                <button
                                    onClick={() => toggleDate(dateKey)}
                                    className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition"
                                >
                                    <div className="flex items-center gap-4">
                                        <FaCalendar className="text-gray-400" />
                                        <div className="text-left">
                                            <h3 className="font-bold text-gray-900">{dateKey}</h3>
                                            <p className="text-sm text-gray-500">
                                                {salesCount} penjualan, {purchasesCount} pembelian
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="text-right">
                                            <p className="text-sm text-gray-500">Total</p>
                                            <p className="font-bold text-gray-900">{formatCurrency(dayTotal)}</p>
                                        </div>
                                        {isExpanded ? <FaChevronUp className="text-gray-400" /> : <FaChevronDown className="text-gray-400" />}
                                    </div>
                                </button>

                                {/* Transactions for this date */}
                                {isExpanded && (
                                    <div className="border-t border-gray-200">
                                        {dayTransactions.map((transaction, idx) => (
                                            <div
                                                key={transaction.id}
                                                className={`px-6 py-4 hover:bg-gray-50 transition ${idx !== dayTransactions.length - 1 ? 'border-b border-gray-100' : ''}`}
                                            >
                                                <div className="flex items-start justify-between gap-4">
                                                    <div className="flex items-start gap-3 flex-1">
                                                        {/* Icon */}
                                                        <div className={`mt-1 p-2 rounded-lg ${transaction.type === 'sale' ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'}`}>
                                                            {transaction.type === 'sale' ? <FaShoppingCart size={16} /> : <FaTruck size={16} />}
                                                        </div>

                                                        {/* Info */}
                                                        <div className="flex-1">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className="font-bold text-gray-900">{transaction.id}</span>
                                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${transaction.type === 'sale' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                                                                    {transaction.type === 'sale' ? 'Penjualan' : 'Pembelian'}
                                                                </span>
                                                                {/* NEW: Explicitly show Customer/Supplier Name here */}
                                                                <span className="text-gray-400">|</span>
                                                                <span className="text-sm font-medium text-gray-700">
                                                                    {transaction.type === 'sale'
                                                                        ? `Pel: ${transaction.customer_name || 'Umum'}`
                                                                        : `Supp: ${transaction.supplier_name || '-'}`
                                                                    }
                                                                </span>
                                                            </div>
                                                            <p className="text-xs text-gray-500 mt-0.5 font-medium">
                                                                {transaction.date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                                                            </p>

                                                            {/* Items */}
                                                            <div className="mt-3 space-y-1">
                                                                {transaction.items?.map((item, itemIdx) => {
                                                                    const unitLabel = transaction.type === 'sale'
                                                                        ? (item.selected_unit === 'bulk' ? (item.bulk_unit_name || 'Unit') : (item.base_unit || 'pcs'))
                                                                        : (item.unit || item.base_unit || 'pcs');

                                                                    const getEffectiveBuyPrice = (item) => {
                                                                        if (!item.buy_price) return 0;
                                                                        // If it's a bulk sale and the buy_price is suspiciously low (less than half the selling price)
                                                                        // it's likely historical data where we only saved the base unit cost.
                                                                        if (item.selected_unit === 'bulk' && item.bulk_unit_conversion) {
                                                                            if (item.buy_price < (item.unit_price / 1.5)) {
                                                                                return item.buy_price * item.bulk_unit_conversion;
                                                                            }
                                                                        }
                                                                        return item.buy_price;
                                                                    };

                                                                    const effectiveBuyPrice = getEffectiveBuyPrice(item);
                                                                    const itemProfit = transaction.type === 'sale' && effectiveBuyPrice
                                                                        ? (item.unit_price - effectiveBuyPrice) * item.qty
                                                                        : 0;

                                                                    return (
                                                                        <div key={itemIdx} className="text-sm text-gray-600 flex justify-between">
                                                                            <span>
                                                                                {item.product_name} × {item.qty} {unitLabel}
                                                                                {isSuperAdmin && transaction.type === 'sale' && itemProfit > 0 && (
                                                                                    <span className="ml-2 text-xs text-green-600 bg-green-50 px-1 rounded">
                                                                                        (Untung: {formatCurrency(itemProfit)})
                                                                                    </span>
                                                                                )}
                                                                            </span>
                                                                            <span className="text-gray-900 font-medium">{formatCurrency(item.total)}</span>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>

                                                            {/* Profit Summary for SuperAdmin */}
                                                            {isSuperAdmin && transaction.type === 'sale' && (
                                                                <div className="mt-2 pt-2 border-t border-dashed border-gray-200 flex justify-between items-center bg-green-50/50 p-2 rounded">
                                                                    <span className="text-xs font-bold text-green-700">Total Keuntungan Transaksi Ini</span>
                                                                    <span className="text-sm font-bold text-green-700">
                                                                        {formatCurrency(
                                                                            transaction.items?.reduce((sum, item) => {
                                                                                const getEffectiveBuyPrice = (item) => {
                                                                                    if (!item.buy_price) return 0;
                                                                                    if (item.selected_unit === 'bulk' && item.bulk_unit_conversion) {
                                                                                        if (item.buy_price < (item.unit_price / 1.5)) {
                                                                                            return item.buy_price * item.bulk_unit_conversion;
                                                                                        }
                                                                                    }
                                                                                    return item.buy_price;
                                                                                };
                                                                                const eBuyPrice = getEffectiveBuyPrice(item);
                                                                                const p = eBuyPrice ? (item.unit_price - eBuyPrice) * item.qty : 0;
                                                                                return sum + p;
                                                                            }, 0)
                                                                        )}
                                                                    </span>
                                                                </div>
                                                            )}

                                                            {/* Actions (Receipt/Print) */}
                                                            <div className="mt-4 flex items-center gap-3">
                                                                {transaction.type === 'sale' ? (
                                                                    <button
                                                                        onClick={() => printReceipt({
                                                                            orderId: transaction.id,
                                                                            orderDate: transaction.date.toLocaleDateString('id-ID'),
                                                                            items: transaction.items,
                                                                            grandTotal: transaction.grand_total,
                                                                            customerName: transaction.customer_name,
                                                                            paymentMethod: transaction.payment_method,
                                                                            isCreditSale: transaction.is_credit_sale
                                                                        })}
                                                                        className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition"
                                                                    >
                                                                        <FaPrint /> Cetak Nota
                                                                    </button>
                                                                ) : (
                                                                    <div className="flex flex-col gap-2">
                                                                        <button
                                                                            onClick={() => printReceipt({
                                                                                orderId: transaction.id,
                                                                                orderDate: transaction.date.toLocaleDateString('id-ID'),
                                                                                items: transaction.items,
                                                                                grandTotal: transaction.total,
                                                                                customerName: transaction.supplier_name,
                                                                                paymentMethod: 'Cash',
                                                                                isPurchase: true
                                                                            })}
                                                                            className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition w-fit"
                                                                        >
                                                                            <FaPrint /> Cetak Bukti Terima
                                                                        </button>
                                                                        {transaction.receipt_file && (
                                                                            <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 text-xs font-bold rounded-lg border border-blue-100 w-fit">
                                                                                <FaFileAlt /> {transaction.receipt_file}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Total Amount */}
                                                    <div className="text-right">
                                                        <p className="text-sm text-gray-500">Total</p>
                                                        <p className="text-lg font-bold text-gray-900">{formatCurrency(transaction.total)}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default TransactionHistoryPage;
