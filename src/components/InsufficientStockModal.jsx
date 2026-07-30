import React from 'react';

export default function InsufficientStockModal({
    isOpen,
    onClose,
    details,
    title = 'Stok Tidak Mencukupi',
    subtitle = 'Beberapa produk melebihi stok yang tersedia',
    description = 'Pesanan tidak dapat diselesaikan karena stok produk berikut kurang dari jumlah yang diminta. Silakan sesuaikan jumlah di keranjang Anda.',
    actionLabel = 'Pahami & Sesuaikan Keranjang'
}) {
    if (!isOpen || !details || details.length === 0) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full overflow-hidden">
                {/* Header */}
                <div className="bg-red-600 text-white p-5 flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-bold">⚠️ {title}</h2>
                        <p className="text-red-100 text-xs mt-1">{subtitle}</p>
                    </div>
                    <button onClick={onClose} className="text-white hover:bg-white/20 rounded-full p-2 transition">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-4">
                    <p className="text-sm text-gray-600">
                        {description}
                    </p>

                    <div className="divide-y divide-gray-100 max-h-[50vh] overflow-y-auto border border-gray-200 rounded-lg">
                        {details.map((item) => {
                            const unitName = item.selected_unit === 'bulk' ? item.bulk_unit_name : item.base_unit;
                            const isBulk = item.selected_unit === 'bulk';
                            
                            return (
                                <div key={item.product_id} className="p-4 flex flex-col gap-2 bg-gray-50/50">
                                    <div className="font-bold text-gray-900">{item.product_name}</div>
                                    <div className="grid grid-cols-3 gap-2 text-xs text-gray-500">
                                        <div>
                                            <span className="block font-medium text-gray-400">Diminta:</span>
                                            <span className="text-sm font-semibold text-gray-800">
                                                {item.qty} {unitName} {isBulk && `(${item.demanded_base} ${item.base_unit})`}
                                            </span>
                                        </div>
                                        <div>
                                            <span className="block font-medium text-gray-400">Tersedia:</span>
                                            <span className="text-sm font-semibold text-amber-700">
                                                {item.available_base} {item.base_unit}
                                            </span>
                                        </div>
                                        <div>
                                            <span className="block font-medium text-gray-400">Kekurangan (Delta):</span>
                                            <span className="text-sm font-bold text-red-600">
                                                -{item.delta_base} {item.base_unit}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Footer */}
                <div className="bg-gray-50 px-6 py-4 flex justify-end border-t border-gray-100">
                    <button
                        onClick={onClose}
                        className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold shadow-md transition text-sm w-full sm:w-auto"
                    >
                        {actionLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
