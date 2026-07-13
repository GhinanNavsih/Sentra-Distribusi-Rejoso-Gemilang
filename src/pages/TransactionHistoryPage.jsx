import React, { useState, useMemo, useEffect } from 'react';
import { orderService } from '../services/orderService';
import { purchaseService } from '../services/purchaseService';
import { FaShoppingCart, FaTruck, FaChevronDown, FaChevronUp, FaCalendar, FaPrint, FaFileAlt } from 'react-icons/fa';
import { printReceipt } from '../utils/standardReceiptGenerator';
import { printWarehouseReceipt } from '../utils/warehouseReceiptGenerator';
import { useUserRole } from '../hooks/useUserRole';
import { productService } from '../services/productService';
import * as XLSX from 'xlsx';
import PrintReceiptModal from '../components/PrintReceiptModal';
import { useAuth } from '../context/AuthContext';

const getFilenameFromUrl = (url) => {
    if (!url) return '';
    if (!url.startsWith('http://') && !url.startsWith('https://')) return url;
    try {
        const decoded = decodeURIComponent(url.split('/o/')[1].split('?')[0]);
        const parts = decoded.split('/');
        const filename = parts[parts.length - 1];
        return filename.replace(/^\d+_/, '');
    } catch (e) {
        return 'Lihat Nota';
    }
};

const EditTransactionModal = ({ isOpen, onClose, transaction, products, onSave }) => {
    const [items, setItems] = useState([]);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (isOpen && transaction) {
            setItems(transaction.items.map(item => ({ ...item })));
        }
    }, [isOpen, transaction]);

    if (!isOpen || !transaction) return null;

    const handleQtyChange = (productId, value) => {
        setItems(prev => prev.map(item => {
            if (item.product_id === productId) {
                const newQty = Math.max(0, parseFloat(value) || 0);
                const price = item.unit_price || item.cost_per_unit || 0;
                return {
                    ...item,
                    qty: newQty,
                    total: newQty * price
                };
            }
            return item;
        }));
    };

    const grandTotal = items.reduce((sum, item) => sum + (item.total || 0), 0);

    const formatCurrency = (value) => {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(value);
    };

    const handleConfirm = async () => {
        setIsSaving(true);
        try {
            const updated = items.map(item => {
                let multiplier = 1;
                if (transaction.type === 'purchase') {
                    const productObj = products.find(p => p.sku === item.product_id);
                    if (productObj && productObj.bulk_unit_name && item.unit === productObj.bulk_unit_name) {
                        multiplier = productObj.bulk_unit_conversion || 1;
                    }
                }
                return {
                    product_id: item.product_id,
                    qty: item.qty,
                    multiplier
                };
            });

            await onSave(transaction.id, updated, transaction.type);
            onClose();
        } catch (e) {
            alert("Gagal mengedit transaksi: " + e.message);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden border border-gray-200 dark:border-gray-700">
                <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-900">
                    <div>
                        <h2 className="text-xl font-bold text-gray-800 dark:text-white">
                            Edit Jumlah Item
                        </h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            No. Transaksi: {transaction.id} ({transaction.type === 'sale' ? 'Penjualan' : 'Pembelian'})
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition">
                        <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="flex-1 overflow-auto p-6 space-y-4">
                    <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-900/50 rounded-lg p-3 text-xs text-yellow-800 dark:text-yellow-200">
                        <span className="font-bold">PENTING:</span> Mengubah jumlah item di sini akan secara otomatis menyesuaikan stok fisik barang di inventori/katalog sesuai selisihnya.
                    </div>

                    <div className="divide-y divide-gray-100 dark:divide-gray-800">
                        {items.map((item, idx) => {
                            const unitLabel = transaction.type === 'sale'
                                ? (item.selected_unit === 'bulk' ? (item.bulk_unit_name || 'Unit') : (item.base_unit || 'pcs'))
                                : (item.unit || item.base_unit || 'pcs');
                            const price = item.unit_price || item.cost_per_unit || 0;

                            return (
                                <div key={item.product_id || idx} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                    <div className="flex-1">
                                        <h4 className="font-semibold text-gray-800 dark:text-gray-200 text-sm">
                                            {item.product_name}
                                        </h4>
                                        <p className="text-xs text-gray-500 mt-0.5">
                                            Harga/satuan: {formatCurrency(price)} per {unitLabel}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="flex items-center border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden bg-white dark:bg-gray-700">
                                            <button
                                                type="button"
                                                onClick={() => handleQtyChange(item.product_id, item.qty - 1)}
                                                className="px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-500 font-bold"
                                            >
                                                -
                                            </button>
                                            <input
                                                type="number"
                                                min="0"
                                                value={item.qty}
                                                onChange={(e) => handleQtyChange(item.product_id, e.target.value)}
                                                className="w-16 text-center py-1.5 outline-none bg-transparent dark:text-white font-medium text-sm font-semibold"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => handleQtyChange(item.product_id, item.qty + 1)}
                                                className="px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-500 font-bold"
                                            >
                                                +
                                            </button>
                                        </div>
                                        <div className="text-right w-28">
                                            <p className="text-xs text-gray-400">Subtotal</p>
                                            <p className="font-bold text-gray-800 dark:text-gray-200 text-sm">
                                                {formatCurrency(item.total || 0)}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex justify-between items-center">
                    <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Total Transaksi Baru</p>
                        <p className="text-lg font-black text-gray-900 dark:text-white">
                            {formatCurrency(grandTotal)}
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                        >
                            Batal
                        </button>
                        <button
                            type="button"
                            onClick={handleConfirm}
                            disabled={isSaving}
                            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-sm transition disabled:opacity-50"
                        >
                            {isSaving ? "Menyimpan..." : "Simpan Perubahan"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const LogEditModal = ({ isOpen, onClose, transaction }) => {
    if (!isOpen || !transaction) return null;

    const changeLogs = [...(transaction.change_logs || [])].reverse(); // Show newest edits first

    const formatCurrency = (value) => {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(value);
    };

    const formatDate = (isoString) => {
        try {
            const date = new Date(isoString);
            return date.toLocaleDateString('id-ID', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }) + ' ' + date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return isoString;
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden border border-gray-200 dark:border-gray-700">
                {/* Header */}
                <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-900">
                    <div>
                        <h2 className="text-xl font-bold text-gray-800 dark:text-white">
                            Riwayat Log Perubahan
                        </h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            No. Transaksi: {transaction.id}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition">
                        <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto p-6 space-y-6">
                    {changeLogs.map((log, index) => {
                        const editNumber = changeLogs.length - index;
                        
                        // Calculate total before and after
                        const totalBefore = log.previous_items?.reduce((sum, item) => sum + (item.total || 0), 0) || 0;
                        const totalAfter = log.new_items?.reduce((sum, item) => sum + (item.total || 0), 0) || 0;

                        // Identify differences
                        const itemDiffs = [];
                        const prevItemsMap = {};
                        log.previous_items?.forEach(item => {
                            prevItemsMap[item.product_id] = item;
                        });

                        log.new_items?.forEach(newItem => {
                            const prevItem = prevItemsMap[newItem.product_id];
                            if (prevItem) {
                                if (prevItem.qty !== newItem.qty) {
                                    const unitLabel = transaction.type === 'sale'
                                        ? (newItem.selected_unit === 'bulk' ? (newItem.bulk_unit_name || 'Unit') : (newItem.base_unit || 'pcs'))
                                        : (newItem.unit || newItem.base_unit || 'pcs');

                                    itemDiffs.push({
                                        product_name: newItem.product_name,
                                        prevQty: prevItem.qty,
                                        newQty: newItem.qty,
                                        prevTotal: prevItem.total || 0,
                                        newTotal: newItem.total || 0,
                                        unitLabel
                                    });
                                }
                            }
                        });

                        return (
                            <div key={index} className="bg-gray-50 dark:bg-gray-900/40 rounded-xl p-4 border border-gray-100 dark:border-gray-800 animate-fadeIn">
                                <div className="flex justify-between items-center mb-3 border-b border-gray-200/60 dark:border-gray-700/60 pb-2">
                                    <div>
                                        <span className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-extrabold uppercase px-2 py-0.5 rounded-md mr-2">
                                            Edit #{editNumber}
                                        </span>
                                        <span className="text-xs text-gray-500 dark:text-gray-400">
                                            oleh <span className="font-bold text-gray-700 dark:text-gray-300">{log.edited_by}</span>
                                        </span>
                                    </div>
                                    <span className="text-xs text-gray-400 font-medium">
                                        {formatDate(log.edited_at)}
                                    </span>
                                </div>

                                <div className="space-y-2">
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400">Perubahan Item:</h4>
                                    <ul className="list-disc list-inside space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
                                        {itemDiffs.map((diff, dIdx) => (
                                            <li key={dIdx} className="leading-relaxed">
                                                <span className="font-semibold text-gray-800 dark:text-gray-200">{diff.product_name}</span>:
                                                <span className="ml-1 text-red-500 font-medium">{diff.prevQty} {diff.unitLabel}</span>
                                                <span className="mx-1.5 text-gray-400">→</span>
                                                <span className="text-green-600 font-bold">{diff.newQty} {diff.unitLabel}</span>
                                                <span className="text-xs text-gray-400 ml-2">
                                                    (Subtotal: {formatCurrency(diff.prevTotal)} → {formatCurrency(diff.newTotal)})
                                                </span>
                                            </li>
                                        ))}
                                        {itemDiffs.length === 0 && (
                                            <li className="italic text-gray-400 list-none">Tidak ada perubahan jumlah item.</li>
                                        )}
                                    </ul>

                                    <div className="mt-4 pt-3 border-t border-dashed border-gray-200 dark:border-gray-700 flex justify-between items-center text-xs">
                                        <span className="font-bold text-gray-500">Total Transaksi:</span>
                                        <span className="font-extrabold text-gray-900 dark:text-white text-sm">
                                            {formatCurrency(totalBefore)} <span className="mx-1 text-gray-400 font-normal">→</span> {formatCurrency(totalAfter)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-5 py-2 bg-gray-800 text-white dark:bg-gray-700 dark:text-gray-100 font-bold rounded-lg text-sm hover:bg-gray-700 dark:hover:bg-gray-600 transition shadow-sm cursor-pointer"
                    >
                        Tutup
                    </button>
                </div>
            </div>
        </div>
    );
};

const TransactionHistoryPage = () => {
    const { isSuperAdmin, isShopper } = useUserRole();
    const { currentUser } = useAuth();
    const [transactions, setTransactions] = useState([]);
    const [products, setProducts] = useState([]);
    const [previewImage, setPreviewImage] = useState(null);
    const [editingTransaction, setEditingTransaction] = useState(null);
    const [printingTransaction, setPrintingTransaction] = useState(null);
    const [logViewingTransaction, setLogViewingTransaction] = useState(null);

    const handleSaveEdit = async (transactionId, updatedItems, type) => {
        try {
            const editorEmail = currentUser?.email || currentUser?.uid || 'Unknown';
            if (type === 'sale') {
                await orderService.updateOrder(transactionId, updatedItems, editorEmail);
            } else {
                await purchaseService.updatePurchase(transactionId, updatedItems, editorEmail);
            }
            alert("Transaksi berhasil diperbarui!");
            handleSearch();
        } catch (e) {
            console.error("Error updating transaction:", e);
            throw e;
        }
    };

    const handleUndoTransaction = async (transaction) => {
        const confirmMsg = `Apakah Anda yakin ingin membatalkan transaksi ${transaction.id}? \nTindakan ini akan mengembalikan stok barang di inventori/katalog dan transaksi ini tidak dapat diaktifkan kembali.`;
        if (!window.confirm(confirmMsg)) return;

        setLoading(true);
        try {
            const operatorEmail = currentUser?.email || currentUser?.uid || 'Unknown';
            if (transaction.type === 'sale') {
                await orderService.cancelOrder(transaction.id, operatorEmail);
            } else {
                await purchaseService.cancelPurchase(transaction.id, operatorEmail);
            }
            alert("Transaksi berhasil dibatalkan!");
            await handleSearch();
        } catch (e) {
            console.error("Error cancelling transaction:", e);
            alert("Gagal membatalkan transaksi: " + e.message);
        } finally {
            setLoading(false);
        }
    };


    const handleOpenReceipt = (receiptFile) => {
        if (!receiptFile) return;
        if (receiptFile.startsWith('http://') || receiptFile.startsWith('https://')) {
            const filename = getFilenameFromUrl(receiptFile).toLowerCase();
            const isImage = filename.endsWith('.jpg') || filename.endsWith('.jpeg') || filename.endsWith('.png');
            if (isImage) {
                setPreviewImage(receiptFile);
            } else {
                window.open(receiptFile, '_blank', 'noopener,noreferrer');
            }
        } else {
            alert(`File nota: "${receiptFile}" tidak dapat dibuka karena hanya nama file yang tersimpan.`);
        }
    };

    const handleExportToExcel = () => {
        try {
            const filtered = transactions.filter(t => (filter === 'all' || t.type === filter) && t.status !== 'cancelled');
            if (filtered.length === 0) {
                alert("Tidak ada data transaksi untuk diexport.");
                return;
            }

            const rows = [];
            filtered.forEach(t => {
                const dateStr = t.date.toLocaleDateString('id-ID', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }) + ' ' + t.date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
                
                const typeLabel = t.type === 'sale' ? 'Penjualan' : 'Pembelian';
                const partner = t.type === 'sale' ? (t.customer_name || 'Umum') : (t.supplier_name || '-');
                
                t.items?.forEach((item) => {
                    const unitLabel = t.type === 'sale'
                        ? (item.selected_unit === 'bulk' ? (item.bulk_unit_name || 'Unit') : (item.base_unit || 'pcs'))
                        : (item.unit || item.base_unit || 'pcs');
                        
                    const price = item.unit_price || item.cost_per_unit || 0;
                    const subtotal = item.total || 0;
                    
                    rows.push({
                        'ID Transaksi': t.id,
                        'Jenis': typeLabel,
                        'Tanggal': dateStr,
                        'Mitra (Pelanggan/Supplier)': partner,
                        'Nama Produk': item.product_name,
                        'Jumlah': item.qty,
                        'Satuan': unitLabel,
                        'Harga Satuan (Rp)': price,
                        'Subtotal Item (Rp)': subtotal,
                        'Total Transaksi (Rp)': t.total,
                        'Metode Pembayaran': t.type === 'sale' ? (t.payment_method || 'Cash') : 'Cash',
                        'Penjualan Kredit': t.type === 'sale' ? (t.is_credit_sale ? 'Ya' : 'Tidak') : '-'
                    });
                });
            });

            const worksheet = XLSX.utils.json_to_sheet(rows);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Transaksi');
            
            const max_width = rows.reduce((w, r) => {
                Object.keys(r).forEach((key, colIdx) => {
                    const cellVal = r[key] ? r[key].toString() : '';
                    w[colIdx] = Math.max(w[colIdx] || 0, cellVal.length, key.length);
                });
                return w;
            }, []);
            worksheet['!cols'] = max_width.map(w => ({ wch: w + 2 }));

            XLSX.writeFile(workbook, `Laporan_Transaksi_${startDate}_sd_${endDate}.xlsx`);
        } catch (e) {
            console.error("Export failed:", e);
            alert("Gagal melakukan export Excel: " + e.message);
        }
    };

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
            const [orders, purchases, allProducts] = await Promise.all([
                orderService.getAllOrders(),
                purchaseService.getAllPurchases(),
                productService.getAllProducts()
            ]);
            setProducts(allProducts);

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
            if (t.status === 'cancelled') return;
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
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
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
                    <div className="flex gap-2">
                        {hasSearched && !loading && transactions.length > 0 && (
                            <button
                                onClick={handleExportToExcel}
                                className="flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-bold text-sm rounded-lg transition shadow-sm cursor-pointer whitespace-nowrap"
                            >
                                <FaFileAlt size={14} />
                                Export ke Excel
                            </button>
                        )}
                        <button
                            onClick={handleSearch}
                            disabled={loading}
                            className="flex-1 bg-blue-600 text-white font-bold py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                        >
                            {loading ? 'Mencari...' : 'Tampilkan Riwayat'}
                        </button>
                    </div>
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
                                                className={`px-6 py-4 hover:bg-gray-50 transition ${idx !== dayTransactions.length - 1 ? 'border-b border-gray-100' : ''} ${transaction.status === 'cancelled' ? 'bg-gray-50/70 dark:bg-gray-800/40 opacity-60' : ''}`}
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
                                                                <span className={`font-bold text-gray-900 ${transaction.status === 'cancelled' ? 'line-through text-gray-400' : ''}`}>{transaction.id}</span>
                                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${transaction.status === 'cancelled' ? 'bg-gray-100 text-gray-400 border border-gray-200' : transaction.type === 'sale' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                                                                    {transaction.status === 'cancelled' ? 'Dibatalkan' : transaction.type === 'sale' ? 'Penjualan' : 'Pembelian'}
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
                                                                        <div key={itemIdx} className={`text-sm text-gray-600 flex justify-between ${transaction.status === 'cancelled' ? 'line-through text-gray-400' : ''}`}>
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
                                                            {isSuperAdmin && transaction.type === 'sale' && transaction.status !== 'cancelled' && (
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
                                                                    <div className="flex flex-wrap gap-2">
                                                                        {transaction.status !== 'cancelled' && (
                                                                            <>
                                                                                <button
                                                                                    onClick={() => setPrintingTransaction(transaction)}
                                                                                    className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition shadow-sm cursor-pointer"
                                                                                >
                                                                                    <FaPrint /> Cetak Nota
                                                                                </button>
                                                                                {(isSuperAdmin || isShopper) && (
                                                                                    <button
                                                                                        onClick={() => setEditingTransaction(transaction)}
                                                                                        className="flex items-center gap-2 px-3 py-1.5 bg-yellow-50 hover:bg-yellow-100 text-yellow-700 text-xs font-bold rounded-lg border border-yellow-200 transition cursor-pointer"
                                                                                    >
                                                                                        Edit Transaksi
                                                                                    </button>
                                                                                )}
                                                                                {isSuperAdmin && (
                                                                                    <button
                                                                                        onClick={() => handleUndoTransaction(transaction)}
                                                                                        className="flex items-center gap-2 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold rounded-lg border border-red-200 transition cursor-pointer"
                                                                                    >
                                                                                        Batalkan Transaksi
                                                                                    </button>
                                                                                )}
                                                                            </>
                                                                        )}
                                                                        {(isSuperAdmin || isShopper) && transaction.change_logs && transaction.change_logs.length > 0 && (
                                                                            <button
                                                                                onClick={() => setLogViewingTransaction(transaction)}
                                                                                className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-lg border border-blue-200 transition cursor-pointer"
                                                                            >
                                                                                Log Edit
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex flex-col gap-2">
                                                                        <div className="flex flex-wrap gap-2">
                                                                            {transaction.status !== 'cancelled' && (
                                                                                <>
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
                                                                                        className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition w-fit shadow-sm cursor-pointer"
                                                                                    >
                                                                                        <FaPrint /> Cetak Bukti Terima
                                                                                    </button>
                                                                                    {(isSuperAdmin || isShopper) && (
                                                                                        <button
                                                                                            onClick={() => setEditingTransaction(transaction)}
                                                                                            className="flex items-center gap-2 px-3 py-1.5 bg-yellow-50 hover:bg-yellow-100 text-yellow-700 text-xs font-bold rounded-lg border border-yellow-200 transition cursor-pointer w-fit"
                                                                                        >
                                                                                            Edit Transaksi
                                                                                        </button>
                                                                                    )}
                                                                                    {isSuperAdmin && (
                                                                                        <button
                                                                                            onClick={() => handleUndoTransaction(transaction)}
                                                                                            className="flex items-center gap-2 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold rounded-lg border border-red-200 transition cursor-pointer w-fit"
                                                                                        >
                                                                                            Batalkan Transaksi
                                                                                        </button>
                                                                                    )}
                                                                                </>
                                                                            )}
                                                                            {(isSuperAdmin || isShopper) && transaction.change_logs && transaction.change_logs.length > 0 && (
                                                                                <button
                                                                                    onClick={() => setLogViewingTransaction(transaction)}
                                                                                    className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-lg border border-blue-200 transition cursor-pointer w-fit"
                                                                                >
                                                                                    Log Edit
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                        {transaction.status !== 'cancelled' && transaction.receipt_file && (
                                                                            <button
                                                                                onClick={() => handleOpenReceipt(transaction.receipt_file)}
                                                                                className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-lg border border-blue-100 w-fit transition cursor-pointer"
                                                                                title="Klik untuk membuka/melihat nota"
                                                                            >
                                                                                <FaFileAlt /> {getFilenameFromUrl(transaction.receipt_file)}
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
 
                                                    {/* Total Amount */}
                                                    <div className="text-right">
                                                        <p className="text-sm text-gray-500">Total</p>
                                                        <p className={`text-lg font-bold text-gray-900 ${transaction.status === 'cancelled' ? 'line-through text-gray-400' : ''}`}>{formatCurrency(transaction.total)}</p>
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

            {/* Image Preview Modal */}
            {previewImage && (
                <div 
                    className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm p-4"
                    onClick={() => setPreviewImage(null)}
                >
                    <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center p-2 bg-gray-900 rounded-lg shadow-2xl border border-gray-700" onClick={(e) => e.stopPropagation()}>
                        <button 
                            className="absolute -top-12 right-0 text-white hover:text-red-500 transition text-sm font-bold flex items-center gap-1 bg-black/40 px-3 py-1.5 rounded-lg border border-gray-700 hover:border-red-500/50 cursor-pointer"
                            onClick={() => setPreviewImage(null)}
                        >
                            Tutup
                        </button>
                        <img 
                            src={previewImage} 
                            alt="Nota Pembelian" 
                            className="max-w-full max-h-[75vh] object-contain rounded-lg shadow-inner"
                        />
                        <div className="mt-4 flex gap-4 w-full justify-between items-center px-2">
                            <span className="text-gray-400 text-xs truncate max-w-[60%]">
                                {getFilenameFromUrl(previewImage)}
                            </span>
                            <a 
                                href={previewImage} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-bold text-xs transition cursor-pointer flex items-center gap-1"
                            >
                                Buka di Tab Baru
                            </a>
                        </div>
                    </div>
                </div>
            )}
            {/* Edit Transaction Modal */}
            <EditTransactionModal
                isOpen={!!editingTransaction}
                onClose={() => setEditingTransaction(null)}
                transaction={editingTransaction}
                products={products}
                onSave={handleSaveEdit}
            />
            {/* Log Edit Modal */}
            <LogEditModal
                isOpen={!!logViewingTransaction}
                onClose={() => setLogViewingTransaction(null)}
                transaction={logViewingTransaction}
            />
            {/* Print Receipt Modal */}
            <PrintReceiptModal
                isOpen={!!printingTransaction}
                onClose={() => setPrintingTransaction(null)}
                orderData={printingTransaction}
                products={products}
                onSaveSuccess={handleSearch}
            />
        </div>
    );
};

export default TransactionHistoryPage;
