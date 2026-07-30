import React, { useState, useEffect } from 'react';
import { downloadReceipt, printReceipt } from '../utils/standardReceiptGenerator';
import { generateWarehouseReceipt, printWarehouseReceipt } from '../utils/warehouseReceiptGenerator';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase.config';
import { getCollectionName } from '../utils/envMode';

export default function PrintReceiptModal({ isOpen, onClose, orderData, products, onSaveSuccess }) {
    const [customerName, setCustomerName] = useState('');
    const [businessType, setBusinessType] = useState('');
    const [paymentMethod, setPaymentMethod] = useState('Cash');
    const [isCreditSale, setIsCreditSale] = useState(false);

    // Receipt format selection
    const [printRegular, setPrintRegular] = useState(false);
    const [printPremium, setPrintPremium] = useState(false);
    const [printStar, setPrintStar] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Sync state with incoming order data
    useEffect(() => {
        if (isOpen && orderData) {
            const tier = orderData.customer_type || 'regular';
            setPrintRegular(tier === 'regular');
            setPrintPremium(tier === 'premium');
            setPrintStar(tier === 'star');
            setCustomerName(orderData.customer_name || '');
            setBusinessType('');
            setPaymentMethod(orderData.payment_method || 'Cash');
            setIsCreditSale(!!orderData.is_credit_sale);
        }
    }, [isOpen, orderData]);

    if (!isOpen || !orderData) return null;

    const isUnpaid = orderData.payment_status === 'unpaid' || orderData.status === 'unpaid';

    // Map items to latest products to get correct tier pricing
    const itemsWithProducts = (orderData.items || []).map(item => {
        const productObj = products.find(p => p.id === item.product_id || p.sku === item.product_id);
        return {
            ...item,
            product_obj: productObj || item.product_obj
        };
    });

    // Recalculate items with different pricing tier (for display, print, and download)
    const recalculateItemsForTier = (tierType) => {
        return itemsWithProducts.map(item => {
            let tierPrice;
            if (item.product_obj) {
                switch (tierType) {
                    case 'star':
                        tierPrice = item.product_obj.price_star || item.product_obj.price_regular || item.unit_price;
                        break;
                    case 'premium':
                        tierPrice = item.product_obj.price_premium || item.product_obj.price_regular || item.unit_price;
                        break;
                    case 'regular':
                    default:
                        tierPrice = item.product_obj.price_regular || item.unit_price;
                        break;
                }
            } else {
                tierPrice = item.unit_price;
            }

            let finalTierPrice = tierPrice;
            if (item.selected_unit === 'bulk') {
                finalTierPrice = tierPrice * (item.bulk_unit_conversion || 1);
            }

            return {
                ...item,
                unit_price: finalTierPrice,
                total: finalTierPrice * item.qty
            };
        });
    };

    const getGrandTotalForTier = (tierType) => {
        const recalculated = recalculateItemsForTier(tierType);
        return recalculated.reduce((sum, item) => sum + item.total, 0);
    };

    // Save order details (customer name, payment method, credit sale) to the database
    const saveOrderDetailsToDB = async (name = customerName, method = paymentMethod, credit = isCreditSale) => {
        if (!orderData?.id) return;
        setIsSaving(true);
        try {
            const orderRef = doc(db, getCollectionName('orders'), orderData.id);
            const updatePayload = {
                customer_name: name.trim() || "",
                payment_method: method,
                is_credit_sale: credit
            };
            await updateDoc(orderRef, updatePayload);
            console.log("Order details updated in DB:", updatePayload);
            if (onSaveSuccess) {
                onSaveSuccess();
            }
        } catch (err) {
            console.error("Failed to update order details:", err);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDownloadReceipts = async () => {
        await saveOrderDetailsToDB(customerName, paymentMethod, isCreditSale);

        const baseData = {
            orderId: orderData.id,
            orderDate: orderData.date instanceof Date ? orderData.date.toLocaleDateString('id-ID') : orderData.date,
            customerName,
            businessType,
            paymentMethod,
            isCreditSale,
            payment_status: orderData.payment_status,
            status: orderData.status,
            target_date: orderData.target_date
        };

        if (printRegular) {
            const receiptData = {
                ...baseData,
                items: recalculateItemsForTier('regular'),
                grandTotal: getGrandTotalForTier('regular'),
            };
            await generateWarehouseReceipt(receiptData);
        }

        if (printPremium) {
            const receiptData = {
                ...baseData,
                items: recalculateItemsForTier('premium'),
                grandTotal: getGrandTotalForTier('premium'),
            };
            downloadReceipt(receiptData);
        }

        if (printStar) {
            const receiptData = {
                ...baseData,
                items: recalculateItemsForTier('star'),
                grandTotal: getGrandTotalForTier('star'),
            };
            downloadReceipt(receiptData);
        }

        setTimeout(onClose, 500);
    };

    const handlePrintReceipts = async () => {
        await saveOrderDetailsToDB(customerName, paymentMethod, isCreditSale);

        const baseData = {
            orderId: orderData.id,
            orderDate: orderData.date instanceof Date ? orderData.date.toLocaleDateString('id-ID') : orderData.date,
            customerName,
            businessType,
            paymentMethod,
            isCreditSale,
            payment_status: orderData.payment_status,
            status: orderData.status,
            target_date: orderData.target_date
        };

        if (printRegular) {
            const receiptData = {
                ...baseData,
                items: recalculateItemsForTier('regular'),
                grandTotal: getGrandTotalForTier('regular'),
            };
            await printWarehouseReceipt(receiptData);
        }

        if (printPremium) {
            const receiptData = {
                ...baseData,
                items: recalculateItemsForTier('premium'),
                grandTotal: getGrandTotalForTier('premium'),
            };
            printReceipt(receiptData);
        }

        if (printStar) {
            const receiptData = {
                ...baseData,
                items: recalculateItemsForTier('star'),
                grandTotal: getGrandTotalForTier('star'),
            };
            printReceipt(receiptData);
        }

        setTimeout(onClose, 500);
    };

    const atLeastOneSelected = printRegular || printPremium || printStar;
    const isNameValid = customerName.trim().length > 0;
    const canProceed = atLeastOneSelected && isNameValid && !isSaving;

    const formatCurrency = (value) => {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(value);
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-2 sm:p-4 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full max-h-[95vh] flex flex-col overflow-hidden border border-gray-200 dark:border-gray-700">
                {/* Header */}
                <div className={`${isUnpaid ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'bg-gradient-to-r from-red-600 to-orange-500'} text-white p-5 rounded-t-xl flex-shrink-0`}>
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                </svg>
                                Cetak Nota Penjualan
                            </h2>
                            <p className="text-white/85 text-xs mt-1 font-medium">No. Nota: {orderData.id}</p>
                        </div>
                        <button
                            onClick={onClose}
                            className="text-white/80 hover:text-white hover:bg-white/20 rounded-full p-2 transition"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Scrollable Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4 dark:text-gray-200">
                    {isUnpaid && (
                        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4 text-center">
                            <div className="text-base font-black text-amber-900 dark:text-amber-200">
                                BELUM LUNAS / PRE-ORDER
                            </div>
                            <div className="mt-1 text-sm font-semibold text-amber-800 dark:text-amber-300">
                                Target: {orderData.target_date || '-'}
                            </div>
                        </div>
                    )}
                    <div className="border-b border-gray-100 dark:border-gray-700 pb-4">
                        <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Detail Pelanggan & Pembayaran</h3>

                        {/* Customer Name */}
                        <div className="mb-3">
                            <label className="block text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-1">
                                Nama Pelanggan <span className="text-red-600">* Wajib</span>
                            </label>
                            <input
                                type="text"
                                placeholder="Wajib diisi (Contoh: Pak Budi)"
                                value={customerName}
                                onChange={(e) => setCustomerName(e.target.value)}
                                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-transparent focus:ring-2 focus:ring-red-500 outline-none text-sm"
                            />
                            {!isNameValid && (
                                <p className="text-[10px] text-red-500 mt-1 font-medium italic">
                                    Silahkan masukkan nama pelanggan untuk mencetak.
                                </p>
                            )}
                        </div>

                        {/* Business Type */}
                        <div className="mb-3">
                            <label className="block text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-1">
                                Jenis Usaha
                            </label>
                            <input
                                type="text"
                                placeholder="Default: Pelanggan Reguler"
                                value={businessType}
                                onChange={(e) => setBusinessType(e.target.value)}
                                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-transparent focus:ring-2 focus:ring-red-500 outline-none text-sm"
                            />
                        </div>

                        {/* Payment Method */}
                        <div className="mb-3">
                            <label className="block text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-1">
                                Metode Pembayaran
                            </label>
                            <select
                                value={paymentMethod}
                                onChange={(e) => setPaymentMethod(e.target.value)}
                                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-transparent dark:bg-gray-800 focus:ring-2 focus:ring-red-500 outline-none text-sm cursor-pointer"
                            >
                                <option value="Cash">Tunai</option>
                                <option value="QRIS">QRIS</option>
                                <option value="Transfer Bank">Transfer Bank</option>
                                <option value="Debit Card">Kartu Debit</option>
                            </select>
                        </div>

                        {/* Credit Sale Toggle */}
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="historyCreditSale"
                                checked={isCreditSale}
                                onChange={(e) => setIsCreditSale(e.target.checked)}
                                className="w-4 h-4 text-red-600 border-gray-300 dark:border-gray-600 rounded focus:ring-red-500"
                            />
                            <label htmlFor="historyCreditSale" className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                                Penjualan Kredit (Invoice)
                            </label>
                        </div>
                    </div>

                    {/* Receipt Format & Price Recalculation Previews */}
                    <div className="bg-red-50/50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/50 rounded-xl p-4 space-y-3">
                        <h4 className="text-sm font-bold text-red-900 dark:text-red-300">
                            Pilih Format & Harga Nota:
                        </h4>
                        
                        <div className="space-y-3">
                            {/* Regular Price Row */}
                            <label className="flex items-center justify-between p-2 rounded hover:bg-red-100/30 dark:hover:bg-red-950/30 transition cursor-pointer">
                                <span className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={printRegular}
                                        onChange={(e) => setPrintRegular(e.target.checked)}
                                        className="w-4 h-4 text-red-600 border-gray-300 rounded focus:ring-red-500"
                                    />
                                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Harga Reguler (Merah)
                                    </span>
                                </span>
                                <span className="text-xs font-bold text-gray-500 dark:text-gray-400">
                                    {formatCurrency(getGrandTotalForTier('regular'))}
                                </span>
                            </label>

                            {/* Premium Price Row */}
                            <label className="flex items-center justify-between p-2 rounded hover:bg-red-100/30 dark:hover:bg-red-950/30 transition cursor-pointer">
                                <span className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={printPremium}
                                        onChange={(e) => setPrintPremium(e.target.checked)}
                                        className="w-4 h-4 text-yellow-600 border-gray-300 rounded focus:ring-yellow-500"
                                    />
                                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Harga Premium (Biru)
                                    </span>
                                </span>
                                <span className="text-xs font-bold text-gray-500 dark:text-gray-400">
                                    {formatCurrency(getGrandTotalForTier('premium'))}
                                </span>
                            </label>

                            {/* Star Price Row */}
                            <label className="flex items-center justify-between p-2 rounded hover:bg-red-100/30 dark:hover:bg-red-950/30 transition cursor-pointer">
                                <span className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={printStar}
                                        onChange={(e) => setPrintStar(e.target.checked)}
                                        className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                                    />
                                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Harga Bintang (Biru)
                                    </span>
                                </span>
                                <span className="text-xs font-bold text-gray-500 dark:text-gray-400">
                                    {formatCurrency(getGrandTotalForTier('star'))}
                                </span>
                            </label>
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="bg-gray-50 dark:bg-gray-900 px-5 py-4 border-t border-gray-100 dark:border-gray-800 flex gap-3 flex-shrink-0">
                    <button
                        onClick={handleDownloadReceipts}
                        disabled={!canProceed}
                        className={`flex-1 py-2.5 rounded-lg font-bold shadow-sm transition flex items-center justify-center gap-2 text-xs ${canProceed
                            ? 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer'
                            : 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                            }`}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Download PDF
                    </button>
                    <button
                        onClick={handlePrintReceipts}
                        disabled={!canProceed}
                        className={`flex-1 py-2.5 rounded-lg font-bold shadow-sm transition flex items-center justify-center gap-2 text-xs ${canProceed
                            ? 'bg-red-600 hover:bg-red-700 text-white cursor-pointer'
                            : 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                            }`}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                        </svg>
                        Cetak Nota
                    </button>
                </div>
            </div>
        </div>
    );
}
