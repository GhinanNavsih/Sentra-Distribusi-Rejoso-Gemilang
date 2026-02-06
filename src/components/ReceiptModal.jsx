import React, { useState } from 'react';
import { downloadReceipt, printReceipt } from '../utils/receiptGenerator';
import { generateWarehouseExitPDF, printWarehouseExitReceipt } from '../utils/warehouseExitGen';
import { productService } from '../services/productService';

export default function ReceiptModal({ isOpen, onClose, orderData }) {
    const [customerName, setCustomerName] = useState('');
    const [paymentMethod, setPaymentMethod] = useState('Cash');
    const [isCreditSale, setIsCreditSale] = useState(false);

    // Receipt format selection (for printing only - doesn't affect saved data)
    const [printRegular, setPrintRegular] = useState(orderData?.selectedCustomerType === 'regular');
    const [printPremium, setPrintPremium] = useState(orderData?.selectedCustomerType === 'premium');
    const [printStar, setPrintStar] = useState(orderData?.selectedCustomerType === 'star');

    if (!isOpen || !orderData) return null;

    // Helper to recalculate items with different pricing tier (for receipt display only)
    const recalculateItemsForTier = (tierType) => {
        console.log('=== RECALCULATING FOR TIER:', tierType, '===');

        return orderData.items.map(item => {
            console.log('Item:', item.product_name);
            console.log('Product obj:', item.product_obj);

            let tierPrice;

            // Access tier-specific prices directly from product_obj
            if (item.product_obj) {
                console.log('Available prices:', {
                    regular: item.product_obj.price_regular,
                    premium: item.product_obj.price_premium,
                    star: item.product_obj.price_star
                });

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
                console.log('NO PRODUCT_OBJ - using unit_price:', item.unit_price);
                // Fallback if product_obj is not available
                tierPrice = item.unit_price;
            }

            console.log('Selected tier price:', tierPrice);

            return {
                ...item,
                unit_price: tierPrice,
                total: tierPrice * item.qty
            };
        });
    };

    const handleDownloadReceipts = () => {
        const baseData = {
            ...orderData,
            customerName,
            paymentMethod,
            isCreditSale
        };

        if (printRegular) {
            const receiptData = {
                ...baseData,
                items: recalculateItemsForTier('regular'),
                grandTotal: recalculateItemsForTier('regular').reduce((sum, item) => sum + item.total, 0),
            };
            generateWarehouseExitPDF(receiptData);
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

    const handlePrintReceipts = () => {
        const baseData = {
            ...orderData,
            customerName,
            paymentMethod,
            isCreditSale
        };

        if (printRegular) {
            const receiptData = {
                ...baseData,
                items: recalculateItemsForTier('regular'),
                grandTotal: recalculateItemsForTier('regular').reduce((sum, item) => sum + item.total, 0),
            };
            printWarehouseExitReceipt(receiptData);
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

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-2xl max-w-md w-full">
                {/* Header */}
                <div className="bg-gradient-to-r from-primary to-red-600 text-white p-6 rounded-t-lg">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-2xl font-bold">✓ Order Berhasil!</h2>
                            <p className="text-red-100 text-sm mt-1">No. Nota: {orderData.orderId}</p>
                            <p className="text-red-100 text-xs mt-1 font-medium">
                                Saved as: {savedTier?.charAt(0).toUpperCase() + savedTier?.slice(1)} tier
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="text-white hover:bg-white/20 rounded-full p-2 transition">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="p-6 space-y-4">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                        <div className="flex items-center gap-2 text-green-800 mb-2">
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            <span className="font-semibold">Transaksi Selesai</span>
                        </div>
                        <div className="text-2xl font-bold text-green-900">
                            Rp {orderData.grandTotal.toLocaleString('id-ID')}
                        </div>
                        <div className="text-xs text-green-700 mt-1">
                            ({savedTier?.charAt(0).toUpperCase() + savedTier?.slice(1)} pricing - saved to database)
                        </div>
                    </div>

                    <div className="border-t border-gray-200 pt-4">
                        <h3 className="font-semibold text-gray-900 mb-3">Detail Nota (Opsional)</h3>

                        {/* Customer Name */}
                        <div className="mb-3">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Nama Pelanggan
                            </label>
                            <input
                                type="text"
                                placeholder="Kosongkan jika tidak perlu"
                                value={customerName}
                                onChange={(e) => setCustomerName(e.target.value)}
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
                                onChange={(e) => setPaymentMethod(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-primary focus:border-primary outline-none">
                                <option value="Cash">Cash</option>
                                <option value="QRIS">QRIS</option>
                                <option value="Transfer Bank">Transfer Bank</option>
                                <option value="Debit Card">Debit Card</option>
                            </select>
                        </div>

                        {/* Credit Sale Toggle */}
                        <div className="flex items-center gap-2 mb-4">
                            <input
                                type="checkbox"
                                id="creditSale"
                                checked={isCreditSale}
                                onChange={(e) => setIsCreditSale(e.target.checked)}
                                className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
                            />
                            <label htmlFor="creditSale" className="text-sm text-gray-700">
                                Penjualan Kredit (Invoice)
                            </label>
                        </div>

                        {/* Receipt Format Selection */}
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <h4 className="text-sm font-semibold text-blue-900 mb-2">
                                Select Receipt Formats to Print:
                            </h4>
                            <p className="text-xs text-blue-700 mb-3">
                                (For display only - database saved with {savedTier?.charAt(0).toUpperCase() + savedTier?.slice(1)} pricing)
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
                                        Regular Pricing (Red Template)
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
                                        Premium Pricing (Blue Template)
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
                                        Star Pricing (Blue Template)
                                    </span>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="bg-gray-50 px-6 py-4 rounded-b-lg flex gap-3">
                    <button
                        onClick={handleDownloadReceipts}
                        disabled={!atLeastOneSelected}
                        className={`flex-1 px-4 py-3 rounded-lg font-semibold shadow-sm transition flex items-center justify-center gap-2 ${atLeastOneSelected
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
                        disabled={!atLeastOneSelected}
                        className={`flex-1 px-4 py-3 rounded-lg font-semibold shadow-sm transition flex items-center justify-center gap-2 ${atLeastOneSelected
                            ? 'bg-primary hover:bg-red-700 text-white'
                            : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                            }`}>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                        </svg>
                        Print
                    </button>
                </div>

                <div className="px-6 pb-4">
                    <button
                        onClick={onClose}
                        className="w-full text-sm text-gray-500 hover:text-gray-700 py-2">
                        Lewati, Tutup
                    </button>
                </div>
            </div>
        </div>
    );
}
