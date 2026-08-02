import React, { useState, useEffect } from 'react';
import { downloadReceipt, printReceipt } from '../utils/standardReceiptGenerator';
import { generateWarehouseReceipt, printWarehouseReceipt } from '../utils/warehouseReceiptGenerator';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase.config';
import { getCollectionName } from '../utils/envMode';

export default function ReceiptModal({ isOpen, onClose, orderData }) {
    const [customerName, setCustomerName] = useState('');
    const [businessType, setBusinessType] = useState('');
    const [paymentMethod, setPaymentMethod] = useState('Cash');
    const [isCreditSale, setIsCreditSale] = useState(false);

    // Receipt format selection (for printing only - doesn't affect saved data)
    const [printRegular, setPrintRegular] = useState(false);
    const [printPremium, setPrintPremium] = useState(false);
    const [printStar, setPrintStar] = useState(false);

    // Auto-check the correct receipt format based on the selected tier
    useEffect(() => {
        if (isOpen && orderData) {
            const tier = orderData.selectedCustomerType;
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setPrintRegular(tier === 'regular');
            setPrintPremium(tier === 'premium');
            setPrintStar(tier === 'star');
            // Sync with what was entered in POS
            setCustomerName(orderData.customer_name || '');
            setBusinessType('');
            setPaymentMethod('Cash');
            setIsCreditSale(false);
        }
    }, [isOpen, orderData]);

    // Save all order details (customer name, payment method, credit sale) to the database
    const saveOrderDetailsToDB = async (name = customerName, method = paymentMethod, credit = isCreditSale) => {
        if (!orderData?.orderId) return;
        try {
            const orderRef = doc(db, getCollectionName('orders'), orderData.orderId);
            await updateDoc(orderRef, {
                customer_name: name.trim() || "",
                payment_method: method,
                is_credit_sale: credit
            });
            console.log("Order details updated in DB");
        } catch (err) {
            console.error("Failed to update order details:", err);
        }
    };

    const handleClose = async () => {
        await saveOrderDetailsToDB(customerName, paymentMethod, isCreditSale);
        onClose();
    };

    if (!isOpen || !orderData) return null;

    const isUnpaid = orderData.payment_status === 'unpaid' || orderData.status === 'unpaid';

    // Helper to recalculate items with different pricing tier (for receipt display only)
    const recalculateItemsForTier = (tierType) => {
        return orderData.items.map(item => {
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

    const handleDownloadReceipts = async () => {
        await saveOrderDetailsToDB(customerName, paymentMethod, isCreditSale);

        const baseData = {
            ...orderData,
            customerName,
            businessType,
            paymentMethod,
            isCreditSale
        };

        if (printRegular) {
            const receiptData = {
                ...baseData,
                items: recalculateItemsForTier('regular'),
                grandTotal: recalculateItemsForTier('regular').reduce((sum, item) => sum + item.total, 0),
            };
            await generateWarehouseReceipt(receiptData);
        }

        if (printPremium) {
            const receiptData = {
                ...baseData,
                items: recalculateItemsForTier('premium'),
                grandTotal: recalculateItemsForTier('premium').reduce((sum, item) => sum + item.total, 0),
            };
            downloadReceipt(receiptData);
        }

        if (printStar) {
            const receiptData = {
                ...baseData,
                items: recalculateItemsForTier('star'),
                grandTotal: recalculateItemsForTier('star').reduce((sum, item) => sum + item.total, 0),
            };
            downloadReceipt(receiptData);
        }

        setTimeout(onClose, 500);
    };

    const handlePrintReceipts = async () => {
        await saveOrderDetailsToDB(customerName, paymentMethod, isCreditSale);

        const baseData = {
            ...orderData,
            customerName,
            businessType,
            paymentMethod,
            isCreditSale
        };

        if (printRegular) {
            const receiptData = {
                ...baseData,
                items: recalculateItemsForTier('regular'),
                grandTotal: recalculateItemsForTier('regular').reduce((sum, item) => sum + item.total, 0),
            };
            await printWarehouseReceipt(receiptData);
        }

        if (printPremium) {
            const receiptData = {
                ...baseData,
                items: recalculateItemsForTier('premium'),
                grandTotal: recalculateItemsForTier('premium').reduce((sum, item) => sum + item.total, 0),
            };
            printReceipt(receiptData);
        }

        if (printStar) {
            const receiptData = {
                ...baseData,
                items: recalculateItemsForTier('star'),
                grandTotal: recalculateItemsForTier('star').reduce((sum, item) => sum + item.total, 0),
            };
            printReceipt(receiptData);
        }

        setTimeout(onClose, 500);
    };

    const savedTier = orderData.selectedCustomerType;
    const atLeastOneSelected = printRegular || printPremium || printStar;
    const isNameValid = customerName.trim().length > 0;
    const canProceed = atLeastOneSelected && isNameValid;

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-2 sm:p-4">
            <div className="bg-white rounded-lg shadow-2xl max-w-md w-full max-h-[95vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className={`${isUnpaid ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'bg-gradient-to-r from-primary to-red-600'} text-white p-4 sm:p-5 rounded-t-lg flex-shrink-0`}>
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-2xl font-bold">
                                {isUnpaid ? 'Pre-Order Berhasil Disimpan' : '✓ Order Berhasil!'}
                            </h2>
                            <p className="text-white/85 text-sm mt-1">No. Nota: {orderData.orderId}</p>
                            <p className="text-white/85 text-xs mt-1 font-medium">
                                Disimpan sebagai: tingkat {savedTier?.charAt(0).toUpperCase() + savedTier?.slice(1)}
                            </p>
                        </div>
                        {isNameValid && (
                            <button
                                onClick={handleClose}
                                className="text-white hover:bg-white/20 rounded-full p-2 transition">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        )}
                    </div>
                </div>

                {/* Scrollable Body */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
                    <div className={`${isUnpaid ? 'bg-amber-50 border-amber-300' : 'bg-green-50 border-green-200'} border rounded-lg p-3 sm:p-4`}>
                        <div className={`flex items-center gap-2 mb-2 ${isUnpaid ? 'text-amber-900' : 'text-green-800'}`}>
                            <span className="font-black">
                                {isUnpaid ? 'BELUM LUNAS / PRE-ORDER' : '✓ Transaksi Selesai'}
                            </span>
                        </div>
                        {isUnpaid && (
                            <div className="mb-2 text-sm font-semibold text-amber-800">
                                Target: {orderData.target_date || '-'} · Stok belum dikurangi
                            </div>
                        )}
                        <div className={`text-2xl font-bold ${isUnpaid ? 'text-amber-950' : 'text-green-900'}`}>
                            Rp {orderData.grandTotal.toLocaleString('id-ID')}
                        </div>
                        <div className={`text-xs mt-1 ${isUnpaid ? 'text-amber-800' : 'text-green-700'}`}>
                            ({savedTier?.charAt(0).toUpperCase() + savedTier?.slice(1)} pricing - disimpan di database)
                        </div>
                    </div>

                    <div className="border-t border-gray-200 pt-4">
                        <h3 className="font-semibold text-gray-900 mb-3">Detail Nota</h3>

                        {/* Customer Name - MANDATORY */}
                        <div className="mb-3">
                            <label className="block text-sm font-bold text-gray-700 mb-1">
                                Nama Pelanggan <span className="text-red-600">* Wajib</span>
                            </label>
                            <input
                                type="text"
                                placeholder="Wajib diisi (Contoh: Pak Budi)"
                                value={customerName}
                                onChange={(e) => setCustomerName(e.target.value)}
                                onBlur={(e) => saveOrderDetailsToDB(e.target.value, paymentMethod, isCreditSale)}
                                className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                            />
                            {!isNameValid && (
                                <p className="text-[10px] text-red-600 mt-1 font-medium italic">
                                    Silahkan masukkan nama pelanggan untuk mencetak atau menutup.
                                </p>
                            )}
                        </div>

                        {/* Business Type */}
                        <div className="mb-3">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Jenis Usaha
                            </label>
                            <input
                                type="text"
                                placeholder="Default: Pelanggan Reguler"
                                value={businessType}
                                onChange={(e) => setBusinessType(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                            />
                        </div>

                        {/* Payment Method */}
                        <div className="mb-3">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Metode Pembayaran
                            </label>
                            <select
                                value={paymentMethod}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    setPaymentMethod(val);
                                    saveOrderDetailsToDB(customerName, val, isCreditSale);
                                }}
                                className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-primary focus:border-primary outline-none">
                                <option value="Cash">Tunai</option>
                                <option value="QRIS">QRIS</option>
                                <option value="Transfer Bank">Transfer Bank</option>
                                <option value="Debit Card">Kartu Debit</option>
                            </select>
                        </div>

                        {/* Credit Sale Toggle */}
                        <div className="flex items-center gap-2 mb-3">
                            <input
                                type="checkbox"
                                id="creditSale"
                                checked={isCreditSale}
                                onChange={(e) => {
                                    const val = e.target.checked;
                                    setIsCreditSale(val);
                                    saveOrderDetailsToDB(customerName, paymentMethod, val);
                                }}
                                className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
                            />
                            <label htmlFor="creditSale" className="text-sm text-gray-700">
                                Penjualan Kredit (Invoice)
                            </label>
                        </div>

                        {/* Receipt Format Selection */}
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4">
                            <h4 className="text-sm font-semibold text-blue-900 mb-2">
                                Pilih Format Nota untuk Cetak:
                            </h4>
                            <p className="text-xs text-blue-700 mb-3">
                                (Database disimpan dengan harga {savedTier?.charAt(0).toUpperCase() + savedTier?.slice(1)})
                            </p>
                            <div className="space-y-2">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={printRegular}
                                        onChange={(e) => setPrintRegular(e.target.checked)}
                                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                    />
                                    <span className="text-sm text-gray-700">
                                        Harga Reguler (Template Merah)
                                    </span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={printPremium}
                                        onChange={(e) => setPrintPremium(e.target.checked)}
                                        className="w-4 h-4 text-yellow-600 border-gray-300 rounded focus:ring-yellow-500"
                                    />
                                    <span className="text-sm text-gray-700">
                                        Harga Premium (Template Biru)
                                    </span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={printStar}
                                        onChange={(e) => setPrintStar(e.target.checked)}
                                        className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                                    />
                                    <span className="text-sm text-gray-700">
                                        Harga Bintang (Template Biru)
                                    </span>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="bg-gray-50 px-5 py-3 rounded-b-lg flex gap-2 flex-shrink-0">
                    <button
                        onClick={handleDownloadReceipts}
                        disabled={!canProceed}
                        className={`flex-1 px-3 py-2.5 rounded-lg font-semibold shadow-sm transition flex items-center justify-center gap-2 text-sm ${canProceed
                            ? 'bg-blue-600 hover:bg-blue-700 text-white'
                            : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                            }`}>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Download PDF
                    </button>
                    <button
                        onClick={handlePrintReceipts}
                        disabled={!canProceed}
                        className={`flex-1 px-3 py-2.5 rounded-lg font-semibold shadow-sm transition flex items-center justify-center gap-2 text-sm ${canProceed
                            ? 'bg-primary hover:bg-red-700 text-white'
                            : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                            }`}>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                        </svg>
                        Print
                    </button>
                </div>
            </div>
        </div>
    );
}
