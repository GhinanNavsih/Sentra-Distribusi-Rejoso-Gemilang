import React, { useState, useEffect, useRef } from "react";
import { FaTimes, FaPlus, FaTrash } from "react-icons/fa";
import { v4 as uuidv4 } from "uuid";
import { inventoryService } from "../services/inventoryService";

// Helper for currency - Strict Integer
const formatCurrency = (value) => {
    if (value === undefined || value === null || value === "") return "";
    if (isNaN(value)) return "";
    return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value);
};

const BulkPurchaseModal = ({ isOpen, onClose, onSuccess, products = [] }) => {
    // Rows state - 3 default rows
    const [rows, setRows] = useState([
        { id: uuidv4(), product: null, qty: "", unit: "", cost: "", subtotal: "" },
        { id: uuidv4(), product: null, qty: "", unit: "", cost: "", subtotal: "" },
        { id: uuidv4(), product: null, qty: "", unit: "", cost: "", subtotal: "" },
    ]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [supplierName, setSupplierName] = useState("");
    const [receiptFile, setReceiptFile] = useState(null);

    // Search/Autocomplete state
    const [searchQuery, setSearchQuery] = useState({});
    const [showDropdown, setShowDropdown] = useState({});

    // Click outside to close dropdowns
    const dropdownRefs = useRef({});

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (Object.keys(showDropdown).length === 0) return;

            // Check if click is outside any active dropdown
            let isOutside = true;
            Object.keys(dropdownRefs.current).forEach(id => {
                if (dropdownRefs.current[id] && dropdownRefs.current[id].contains(event.target)) {
                    isOutside = false;
                }
            });

            if (isOutside) {
                setShowDropdown({});
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [showDropdown]);

    // Reset when opened
    useEffect(() => {
        if (isOpen) {
            setRows([
                { id: uuidv4(), product: null, qty: "", unit: "", cost: "", subtotal: "" },
                { id: uuidv4(), product: null, qty: "", unit: "", cost: "", subtotal: "" },
                { id: uuidv4(), product: null, qty: "", unit: "", cost: "", subtotal: "" },
            ]);
            setSearchQuery({});
            setShowDropdown({});
            setSupplierName("");
            setReceiptFile(null);
        }
    }, [isOpen]);

    // Add Row
    const addRow = () => {
        setRows([...rows, { id: uuidv4(), product: null, qty: "", unit: "", cost: "", subtotal: "" }]);
    };

    // Remove Row
    const removeRow = (id) => {
        if (rows.length > 1) {
            setRows(rows.filter((r) => r.id !== id));
            // Cleanup search state
            const newQueries = { ...searchQuery };
            delete newQueries[id];
            setSearchQuery(newQueries);
        }
    };

    // Handle Product Selection
    const selectProduct = (rowId, product) => {
        setRows((prev) =>
            prev.map((row) => {
                if (row.id === rowId) {
                    return {
                        ...row,
                        product,
                        unit: product.bulk_unit_name || product.base_unit,
                        qty: "", // Reset qty to force entry
                        cost: "", // Reset cost to force entry
                        subtotal: 0,
                    };
                }
                return row;
            })
        );
        setShowDropdown((prev) => ({ ...prev, [rowId]: false }));
    };

    // Handle Input Changes
    const updateRow = (id, field, value) => {
        setRows((prev) =>
            prev.map((row) => {
                if (row.id === id) {
                    let updatedRow = { ...row, [field]: value };

                    // Sanitize numerical inputs
                    if (field === 'cost' || field === 'subtotal') {
                        if (value !== '' && !/^\d+$/.test(value)) {
                            return row;
                        }
                    }

                    // 1. Handle Unit Conversion: Adjust Qty and Cost while keeping Subtotal same
                    if (field === 'unit' && row.product && row.product.bulk_unit_name) {
                        const conversion = row.product.bulk_unit_conversion || 1;
                        const currentQty = parseFloat(row.qty) || 0;
                        const currentCost = parseFloat(row.cost) || 0;

                        if (value === row.product.base_unit && row.unit === row.product.bulk_unit_name) {
                            // Bulk -> Base: Multiply Qty, Divide Cost
                            updatedRow.qty = currentQty * conversion;
                            updatedRow.cost = Math.round(currentCost / conversion).toString();
                        } else if (value === row.product.bulk_unit_name && row.unit === row.product.base_unit) {
                            // Base -> Bulk: Divide Qty, Multiply Cost
                            updatedRow.qty = currentQty / conversion;
                            updatedRow.cost = Math.round(currentCost * conversion).toString();
                        }
                    }

                    // 2. Reconcile Subtotal based on the (possibly converted) Qty and Cost
                    const q = field === 'qty' ? (parseFloat(value) || 0) : (parseFloat(updatedRow.qty) || 0);

                    if (field === 'subtotal') {
                        // User entered Total -> Calculate unit cost
                        const s = parseFloat(value) || 0;
                        if (q > 0) {
                            updatedRow.cost = Math.round(s / q).toString();
                        }
                    } else {
                        // Calculate/Re-calculate Subtotal
                        const c = field === 'cost' ? (parseFloat(value) || 0) : (parseFloat(updatedRow.cost) || 0);
                        updatedRow.subtotal = Math.round(q * c);
                    }

                    return updatedRow;
                }
                return row;
            })
        );
    };

    // Calculate Grand Total
    const grandTotal = rows.reduce((sum, row) => sum + (parseFloat(row.subtotal) || 0), 0);

    // Submit Handler
    const handleSubmit = async () => {
        setIsSubmitting(true);
        try {
            const validRows = rows.filter((r) => r.product && r.qty > 0);

            if (validRows.length === 0) {
                alert("Silakan tambahkan setidaknya satu item yang valid.");
                setIsSubmitting(false);
                return;
            }

            // Import services dynamically
            const { productService } = await import('../services/productService');
            const { purchaseService } = await import('../services/purchaseService');

            // Prepare purchase items
            const purchaseItems = [];
            let grandTotal = 0;

            // Process each row
            for (const row of validRows) {
                const { product, qty, unit, cost } = row;

                let multiplier = 1;
                if (unit === product.bulk_unit_name) {
                    multiplier = product.bulk_unit_conversion || 1;
                }

                const changeInBaseUnits = parseFloat(qty) * multiplier;
                const totalCost = parseFloat(cost) * parseFloat(qty);

                // Calculate cost per base unit
                const costPerBaseUnit = parseFloat(cost) / multiplier;

                // Update Inventory
                await inventoryService.updateStock(product.sku, changeInBaseUnits);

                // Update Product with cost_price
                await productService.saveProduct({
                    sku: product.sku,
                    cost_price: costPerBaseUnit
                });

                // Add to purchase items
                purchaseItems.push({
                    product_id: product.sku,
                    product_name: product.name,
                    qty: parseFloat(qty),
                    unit: unit,
                    cost_per_unit: parseFloat(cost),
                    total: totalCost
                });

                grandTotal += totalCost;

                console.log(`Added ${changeInBaseUnits} ${product.base_unit} of ${product.name} at ${costPerBaseUnit} per ${product.base_unit}`);
            }

            // Save purchase record
            await purchaseService.createPurchase({
                items: purchaseItems,
                grand_total: grandTotal,
                supplier_name: supplierName || 'N/A',
                receipt_file: receiptFile ? receiptFile.name : null
            });

            onSuccess();
            onClose();
        } catch (error) {
            console.error("Error adding stock:", error);
            alert("Gagal menambah stok.");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">

                {/* Header */}
                <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-900">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Terima Barang (Pembelian)</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Tambah stok ke inventori</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition">
                        <FaTimes className="text-gray-500" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-auto p-6" style={{ minHeight: "300px" }}>
                    {/* Supplier Info Section */}
                    <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4 bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                        {/* Supplier Name */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                Nama Supplier
                            </label>
                            <input
                                type="text"
                                value={supplierName}
                                onChange={(e) => setSupplierName(e.target.value)}
                                placeholder="Masukkan nama supplier (opsional)"
                                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 outline-none transition"
                            />
                        </div>

                        {/* Receipt Upload */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                Upload Nota (Opsional)
                            </label>
                            <div className="flex items-center gap-2">
                                <label className="flex-1 cursor-pointer">
                                    <div className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 transition flex items-center justify-between">
                                        <span className="text-sm text-gray-600 dark:text-gray-300 truncate">
                                            {receiptFile ? receiptFile.name : "Pilih file..."}
                                        </span>
                                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                        </svg>
                                    </div>
                                    <input
                                        type="file"
                                        accept=".jpg,.jpeg,.png,.pdf"
                                        onChange={(e) => setReceiptFile(e.target.files[0])}
                                        className="hidden"
                                    />
                                </label>
                                {receiptFile && (
                                    <button
                                        onClick={() => setReceiptFile(null)}
                                        className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition"
                                        title="Hapus file"
                                    >
                                        <FaTimes />
                                    </button>
                                )}
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                Diterima: JPG, JPEG, PNG, PDF
                            </p>
                        </div>
                    </div>

                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="text-sm font-semibold text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                                <th className="py-3 px-2 w-1/3">Produk</th>
                                <th className="py-3 px-2 w-24">Satuan</th>
                                <th className="py-3 px-2 w-24">Qty</th>
                                <th className="py-3 px-2 w-48">Harga / Satuan <span className="text-xs font-normal text-gray-400">(Rp)</span></th>
                                <th className="py-3 px-2 w-36">Subtotal</th>
                                <th className="py-3 px-2 w-10"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {rows.map((row) => (
                                <tr key={row.id} className="group hover:bg-gray-50 dark:hover:bg-gray-800/50 transition">

                                    {/* Product Search */}
                                    <td className="p-2 relative" ref={el => dropdownRefs.current[row.id] = el}>
                                        <input
                                            type="text"
                                            autoComplete="off"
                                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 outline-none transition"
                                            placeholder="Cari produk..."
                                            value={row.product ? row.product.name : (searchQuery[row.id] || "")}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                setSearchQuery({ ...searchQuery, [row.id]: val });
                                                setShowDropdown({ ...showDropdown, [row.id]: true });
                                                // If there was a product selected, clear it so they can search again
                                                if (row.product) {
                                                    updateRow(row.id, "product", null);
                                                    setSearchQuery({ ...searchQuery, [row.id]: val }); // Ensure query updates
                                                }
                                            }}
                                            onFocus={() => {
                                                setShowDropdown({ ...showDropdown, [row.id]: true });
                                                // Pre-fill query if product exists to allow editing
                                                if (row.product && !searchQuery[row.id]) {
                                                    setSearchQuery({ ...searchQuery, [row.id]: row.product.name });
                                                }
                                            }}
                                        />

                                        {/* Dropdown */}
                                        {showDropdown[row.id] && !row.product && (
                                            <div className="absolute top-full left-0 w-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 list-none shadow-lg rounded-lg mt-1 max-h-48 overflow-auto z-50">
                                                {products
                                                    .filter(p => p.name.toLowerCase().includes((searchQuery[row.id] || "").toLowerCase()))
                                                    .map(p => (
                                                        <div
                                                            key={p.sku}
                                                            className="px-4 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/30 cursor-pointer text-sm border-b border-gray-100 dark:border-gray-700 last:border-0"
                                                            onClick={() => selectProduct(row.id, p)}
                                                        >
                                                            <div className="font-medium text-gray-900 dark:text-gray-100">{p.name}</div>
                                                            <div className="text-xs text-gray-500">SKU: {p.sku}</div>
                                                        </div>
                                                    ))}
                                                {products.filter(p => p.name.toLowerCase().includes((searchQuery[row.id] || "").toLowerCase())).length === 0 && (
                                                    <div className="px-4 py-2 text-sm text-gray-500">Tidak ada produk ditemukan</div>
                                                )}
                                            </div>
                                        )}
                                    </td>

                                    {/* Unit Selection */}
                                    <td className="p-2">
                                        <select
                                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 bg-white dark:bg-gray-700 outline-none focus:ring-2 focus:ring-blue-500"
                                            value={row.unit}
                                            disabled={!row.product}
                                            onChange={(e) => updateRow(row.id, "unit", e.target.value)}
                                        >
                                            {row.product && (
                                                <>
                                                    <option value={row.product.base_unit}>{row.product.base_unit}</option>
                                                    {row.product.bulk_unit_name && (
                                                        <option value={row.product.bulk_unit_name}>{row.product.bulk_unit_name}</option>
                                                    )}
                                                </>
                                            )}
                                        </select>
                                    </td>

                                    {/* Quantity */}
                                    <td className="p-2">
                                        <input
                                            type="number"
                                            min="0"
                                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 outline-none focus:ring-2 focus:ring-blue-500 text-right"
                                            value={row.qty}
                                            onChange={(e) => updateRow(row.id, "qty", e.target.value)}
                                            placeholder="0"
                                        />
                                    </td>

                                    {/* Cost */}
                                    <td className="p-2">
                                        <div className="relative">
                                            <span className="absolute left-3 top-2 text-gray-500 text-sm">Rp</span>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg pl-9 pr-3 py-2 bg-white dark:bg-gray-700 outline-none focus:ring-2 focus:ring-blue-500 text-right"
                                                value={row.cost}
                                                onChange={(e) => updateRow(row.id, "cost", e.target.value)}
                                                placeholder="0"
                                            />
                                        </div>
                                    </td>

                                    {/* Subtotal */}
                                    <td className="p-2">
                                        <div className="relative">
                                            <span className="absolute left-3 top-2 text-gray-400 text-sm">Rp</span>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg pl-9 pr-3 py-2 bg-gray-50 dark:bg-gray-800/50 outline-none focus:ring-2 focus:ring-blue-500 text-right font-medium text-gray-700 dark:text-gray-300"
                                                value={row.subtotal}
                                                onChange={(e) => updateRow(row.id, "subtotal", e.target.value)}
                                                placeholder="0"
                                            />
                                        </div>
                                    </td>

                                    {/* Actions */}
                                    <td className="p-2 text-center">
                                        <button
                                            onClick={() => removeRow(row.id)}
                                            className="text-red-500 hover:text-red-700 hover:bg-red-50 p-2 rounded-full transition disabled:opacity-50"
                                            disabled={rows.length === 1}
                                        >
                                            <FaTrash size={14} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    <button
                        onClick={addRow}
                        className="mt-4 flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium px-4 py-2 hover:bg-blue-50 rounded-lg transition"
                    >
                        <FaPlus size={14} /> Tambah Item
                    </button>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex justify-end items-center gap-4">
                    <div className="text-right mr-4">
                        <span className="text-gray-500 dark:text-gray-400 text-sm">Total Pembelian</span>
                        <div className="text-2xl font-bold text-gray-800 dark:text-white">{formatCurrency(grandTotal)}</div>
                    </div>
                    <button
                        onClick={onClose}
                        className="px-6 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 font-medium hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                    >
                        Batal
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting}
                        className="px-8 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition shadow-lg shadow-blue-500/30 disabled:opacity-70 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isSubmitting ? "Memproses..." : "Konfirmasi Penerimaan"}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BulkPurchaseModal;
