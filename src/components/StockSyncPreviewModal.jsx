import React, { useEffect, useState } from 'react';
import { posLinkService } from '../services/posLinkService';

// Mirrors the base_qty computation createSale does server-side (functions/shared/inventoryMath.js
// snapshotLine): bulk quantities convert through bulk_unit_conversion, unless the base and bulk
// unit names are the same, in which case the conversion is 1. This is the same pattern already
// used throughout PosPage.jsx for price calculations.
const computeBaseQty = (item) => {
    const baseUnitLower = (item.base_unit || '').toLowerCase().trim();
    const bulkUnitLower = (item.bulk_unit_name || '').toLowerCase().trim();
    const isSameUnit = baseUnitLower && bulkUnitLower && baseUnitLower === bulkUnitLower;
    const conversion = isSameUnit ? 1 : (item.bulk_unit_conversion || 1);
    const qty = Number(item.qty) || 0;
    return item.selected_unit === 'bulk' ? qty * conversion : qty;
};

/**
 * Shown instead of the print receipt when the sale went to a stock-synced
 * customer. There is nothing to print for a B2B stock delivery -- what
 * matters to the operator is what will happen to the buyer's POS inventory,
 * so this previews current stock -> updated stock per linked item instead.
 *
 * Several SDRG lines can map to the same POS item (bought under two SKUs
 * that are the same ingredient there); those are combined into one row, the
 * same way POS itself combines them before applying a delivery. Unlinked
 * items still show, listed after the linked ones, since selling them still
 * happened -- they just won't move any POS stock until someone links them.
 */
export default function StockSyncPreviewModal({ isOpen, onClose, orderData }) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [linkedRows, setLinkedRows] = useState([]);
    const [unlinkedRows, setUnlinkedRows] = useState([]);

    useEffect(() => {
        if (!isOpen || !orderData) return;
        let cancelled = false;
        setLoading(true);
        setError('');

        (async () => {
            try {
                const [links, catalog] = await Promise.all([
                    posLinkService.getLinks(),
                    posLinkService.getCatalog()
                ]);
                if (cancelled) return;

                const catalogById = Object.fromEntries(catalog.map(item => [item.id, item]));
                const grouped = new Map(); // posItemId -> { name, unit, current, deltaQty }
                const unlinked = [];

                (orderData.items || []).forEach(item => {
                    const link = links[item.product_id];
                    const baseQty = computeBaseQty(item);
                    const unitLabel = item.selected_unit === 'bulk' ? item.bulk_unit_name : item.base_unit;

                    if (!link?.inventory_item_id) {
                        unlinked.push({ name: item.product_name, qty: item.qty, unit: unitLabel });
                        return;
                    }

                    const posItem = catalogById[link.inventory_item_id];
                    const existing = grouped.get(link.inventory_item_id);
                    if (existing) {
                        existing.deltaQty += baseQty;
                    } else {
                        grouped.set(link.inventory_item_id, {
                            name: posItem?.name || link.inventory_item_name || link.inventory_item_id,
                            unit: posItem?.unit || link.pos_unit || '',
                            // null (not 0) when the POS item can't be found, so the row can say so
                            // rather than implying a false starting stock of zero.
                            current: posItem ? Number(posItem.stock || 0) : null,
                            deltaQty: baseQty
                        });
                    }
                });

                setLinkedRows([...grouped.values()]);
                setUnlinkedRows(unlinked);
            } catch (err) {
                if (!cancelled) setError(err.message || 'Gagal memuat pratinjau stok POS.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [isOpen, orderData]);

    if (!isOpen || !orderData) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                <div className="bg-gradient-to-r from-primary to-red-700 text-white p-5 rounded-t-xl">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-lg font-bold flex items-center gap-2">
                                <span aria-hidden="true">✓</span> Order Berhasil!
                            </p>
                            <p className="text-sm opacity-90 mt-0.5">No. Nota: {orderData.orderId}</p>
                        </div>
                        <button
                            onClick={onClose}
                            className="text-white/80 hover:text-white text-2xl leading-none"
                            aria-label="Tutup"
                        >
                            &times;
                        </button>
                    </div>
                </div>

                <div className="p-5 space-y-4">
                    <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                        <p className="text-sm font-bold text-green-800">
                            Total: Rp {Number(orderData.grandTotal || 0).toLocaleString('id-ID')}
                        </p>
                        <p className="text-xs text-green-700 mt-0.5">
                            Penjualan ke {orderData.customer_name || 'pelanggan ini'} akan memperbarui stok berikut
                            di aplikasi POS mereka.
                        </p>
                    </div>

                    {loading ? (
                        <p className="text-sm text-gray-400 text-center py-6">Memuat pratinjau stok POS...</p>
                    ) : error ? (
                        <p className="text-sm text-red-600 text-center py-4">{error}</p>
                    ) : (
                        <div className="space-y-2">
                            {linkedRows.map(row => {
                                const current = row.current ?? 0;
                                const updated = current + row.deltaQty;
                                const isWhole = Math.abs(updated - Math.round(updated)) < 1e-6;
                                return (
                                    <div
                                        key={row.name}
                                        className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3"
                                    >
                                        <div>
                                            <p className="font-bold text-gray-900 text-sm">{row.name}</p>
                                            {row.current === null && (
                                                <p className="text-xs text-gray-400">Bahan POS tidak ditemukan</p>
                                            )}
                                            {!isWhole && (
                                                <p className="text-xs text-orange-600">Perlu dibulatkan manual di POS</p>
                                            )}
                                        </div>
                                        <div className="text-right shrink-0">
                                            <span className="text-gray-400 text-sm">{row.current ?? '?'}</span>
                                            <span className="mx-1.5 text-gray-400">&rarr;</span>
                                            <span className="font-bold text-green-700 text-sm">
                                                {isWhole ? Math.round(updated) : updated.toFixed(2)}
                                            </span>
                                            {row.unit && <span className="text-gray-400 text-xs ml-1">{row.unit}</span>}
                                        </div>
                                    </div>
                                );
                            })}

                            {unlinkedRows.map((row, index) => (
                                <div
                                    key={`unlinked-${index}`}
                                    className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3"
                                >
                                    <div>
                                        <p className="font-medium text-gray-700 text-sm">{row.name}</p>
                                        <p className="text-xs text-gray-400">Belum tertaut ke bahan POS</p>
                                    </div>
                                    <span className="text-gray-500 text-sm shrink-0">{row.qty} {row.unit}</span>
                                </div>
                            ))}

                            {linkedRows.length === 0 && unlinkedRows.length === 0 && (
                                <p className="text-sm text-gray-400 text-center py-4">Tidak ada item untuk ditampilkan.</p>
                            )}
                        </div>
                    )}
                </div>

                <div className="p-5 border-t border-gray-100">
                    <button
                        onClick={onClose}
                        className="w-full py-3 bg-primary hover:bg-red-700 text-white rounded-lg font-bold shadow-md"
                    >
                        Tutup
                    </button>
                </div>
            </div>
        </div>
    );
}
