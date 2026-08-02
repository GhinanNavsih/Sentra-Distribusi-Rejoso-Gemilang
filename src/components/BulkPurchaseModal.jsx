import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { FaTimes, FaPlus, FaTrash } from "react-icons/fa";
import { v4 as uuidv4 } from "uuid";
import { storage } from "../firebase.config";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { formatPriceInput, parsePrice, parseLocaleNumber } from "../utils/decimalHelper";


// Helper for currency - Strict Integer
const formatCurrency = (value) => {
    if (value === undefined || value === null || value === "") return "";
    if (isNaN(value)) return "";
    return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(value);
};

const BulkPurchaseModal = ({ isOpen, onClose, onSuccess, products = [], initialItems = [] }) => {
    // Rows state - load from localStorage if available, otherwise 3 default blank rows
    const [rows, setRows] = useState(() => {
        try {
            const saved = localStorage.getItem("purchase_draft_rows");
            return saved ? JSON.parse(saved) : [
                { id: uuidv4(), product: null, qty: "", unit: "", cost: "", subtotal: "" },
                { id: uuidv4(), product: null, qty: "", unit: "", cost: "", subtotal: "" },
                { id: uuidv4(), product: null, qty: "", unit: "", cost: "", subtotal: "" },
            ];
        } catch (error) {
            console.error("Error reading purchase_draft_rows from localStorage:", error);
            return [
                { id: uuidv4(), product: null, qty: "", unit: "", cost: "", subtotal: "" },
                { id: uuidv4(), product: null, qty: "", unit: "", cost: "", subtotal: "" },
                { id: uuidv4(), product: null, qty: "", unit: "", cost: "", subtotal: "" },
            ];
        }
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [supplierName, setSupplierName] = useState(() => {
        try {
            return localStorage.getItem("purchase_draft_supplier") || "";
        } catch {
            return "";
        }
    });
    const [receiptFile, setReceiptFile] = useState(null);

    // Search/Autocomplete state
    const [searchQuery, setSearchQuery] = useState({});
    const [showDropdown, setShowDropdown] = useState({});

    // Click outside to close dropdowns
    const dropdownRefs = useRef({});
    const inputRefs = useRef({});
    const portalRef = useRef(null);
    const [dropdownPos, setDropdownPos] = useState({});

    const getFilteredProducts = (query) => {
        if (!query) return products;
        const queryWords = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
        if (queryWords.length === 0) return products;
        return products.filter(p => {
            const nameLower = (p.name || '').toLowerCase();
            const skuLower = (p.sku || '').toLowerCase();
            return queryWords.every(word => nameLower.includes(word) || skuLower.includes(word));
        });
    };

    const updateDropdownPos = useCallback((rowId) => {
        const inputEl = inputRefs.current[rowId];
        if (inputEl) {
            const rect = inputEl.getBoundingClientRect();
            setDropdownPos(prev => ({ ...prev, [rowId]: { top: rect.bottom + 4, left: rect.left, width: rect.width } }));
        }
    }, []);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (Object.keys(showDropdown).length === 0) return;

            // Check if click is outside any active dropdown or the portal itself
            let isOutside = true;
            Object.keys(dropdownRefs.current).forEach(id => {
                if (dropdownRefs.current[id] && dropdownRefs.current[id].contains(event.target)) {
                    isOutside = false;
                }
            });

            if (portalRef.current && portalRef.current.contains(event.target)) {
                isOutside = false;
            }

            if (isOutside) {
                setShowDropdown({});
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [showDropdown]);

    // Reset state on open (except persisted rows and supplier)
    useEffect(() => {
        if (isOpen) {
            setShowDropdown({});
            setReceiptFile(null);
        }
    }, [isOpen]);

    // Replace the current draft when the modal is opened from the demand planner.
    useEffect(() => {
        if (!isOpen || initialItems.length === 0 || products.length === 0) return;

        const importedRows = initialItems.map((initialItem) => {
            const product = products.find(p =>
                p.id === initialItem.product_id || p.sku === initialItem.product_id
            );
            if (!product) return null;

            const qty = Number(initialItem.qty) || 0;
            const unitCost = Number(product.cost_price) || 0;
            return {
                id: uuidv4(),
                product,
                qty,
                unit: product.base_unit,
                cost: unitCost > 0 ? formatPriceInput(unitCost) : "",
                subtotal: unitCost > 0 ? formatPriceInput(Math.ceil(qty * unitCost)) : ""
            };
        }).filter(Boolean);

        if (importedRows.length > 0) {
            setRows(importedRows);
            setSearchQuery({});
            setShowDropdown({});
        }
    }, [isOpen, initialItems, products]);

    // Save rows and supplier name to localStorage when they change
    useEffect(() => {
        localStorage.setItem("purchase_draft_rows", JSON.stringify(rows));
    }, [rows]);

    useEffect(() => {
        localStorage.setItem("purchase_draft_supplier", supplierName);
    }, [supplierName]);

    // Sync draft items with latest firebase database products
    useEffect(() => {
        if (!products || products.length === 0) return;

        setRows((prevRows) => {
            let changed = false;
            const updated = prevRows.map((row) => {
                if (!row.product) return row;

                const latestProduct = products.find(
                    (p) => p.sku === row.product.sku || p.id === row.product.id
                );

                if (!latestProduct) {
                    // Product deleted from database
                    changed = true;
                    return {
                        id: row.id,
                        product: null,
                        qty: "",
                        unit: "",
                        cost: "",
                        subtotal: "",
                    };
                }

                // Check if key product properties or reference changed
                const isProductChanged =
                    row.product !== latestProduct ||
                    row.product.name !== latestProduct.name ||
                    row.product.base_unit !== latestProduct.base_unit ||
                    row.product.bulk_unit_name !== latestProduct.bulk_unit_name ||
                    row.product.bulk_unit_conversion !== latestProduct.bulk_unit_conversion;

                if (isProductChanged) {
                    changed = true;

                    // Reconcile units
                    let newUnit = row.unit;
                    if (row.unit === row.product.bulk_unit_name) {
                        newUnit = latestProduct.bulk_unit_name || latestProduct.base_unit;
                    } else if (row.unit === row.product.base_unit) {
                        newUnit = latestProduct.base_unit;
                    } else {
                        newUnit = latestProduct.bulk_unit_name || latestProduct.base_unit;
                    }

                    return {
                        ...row,
                        product: latestProduct,
                        unit: newUnit,
                    };
                }

                return row;
            });

            return changed ? updated : prevRows;
        });
    }, [products]);

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
                    const baseUnitLower = (product.base_unit || "").toLowerCase().trim();
                    const bulkUnitLower = (product.bulk_unit_name || "").toLowerCase().trim();
                    const isSameUnit = baseUnitLower && bulkUnitLower && baseUnitLower === bulkUnitLower;

                    const defaultUnit = product.bulk_unit_name || product.base_unit;
                    const isBulk = product.bulk_unit_name && defaultUnit === product.bulk_unit_name && !isSameUnit;
                    const conversion = isSameUnit ? 1 : (product.bulk_unit_conversion || 1);
                    const dbCost = product.cost_price || 0;
                    const initialCostVal = isBulk ? dbCost * conversion : dbCost;
                    const formattedCost = initialCostVal > 0 ? formatPriceInput(Math.ceil(initialCostVal)) : "";

                    return {
                        ...row,
                        product,
                        unit: defaultUnit,
                        qty: "", // Reset qty to force entry
                        cost: formattedCost, // Auto input current price
                        subtotal: 0,
                    };
                }
                return row;
            })
        );
        setShowDropdown((prev) => ({ ...prev, [rowId]: false }));
    };

    // Helper for parsing quantity safely
    const parseQtyVal = (v) => {
        if (v === undefined || v === null || v === '') return 0;
        const cleaned = v.toString().replace(/,/g, '.');
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? 0 : parsed;
    };

    // Handle Input Changes
    const updateRow = (id, field, value) => {
        setRows((prev) =>
            prev.map((row) => {
                if (row.id === id) {
                    let updatedRow = { ...row, [field]: value };

                    // Sanitize numerical inputs
                    if (field === 'qty') {
                        // Allow decimal qty input
                        const cleanQty = value.toString().replace(/,/g, '.');
                        updatedRow.qty = value === '' ? '' : (parseFloat(cleanQty) || 0);
                    } else if (field === 'cost' || field === 'subtotal') {
                        // Allow decimals dynamically (formatted as user types)
                        updatedRow[field] = formatPriceInput(value);
                    }

                    // 1. Handle Unit Conversion: Adjust Qty and Cost while keeping Subtotal same
                    if (field === 'unit' && row.product && row.product.bulk_unit_name) {
                        const baseUnitLower = (row.product.base_unit || "").toLowerCase().trim();
                        const bulkUnitLower = (row.product.bulk_unit_name || "").toLowerCase().trim();
                        const isSameUnit = baseUnitLower && bulkUnitLower && baseUnitLower === bulkUnitLower;
                        const conversion = isSameUnit ? 1 : (row.product.bulk_unit_conversion || 1);
                        const currentQty = parseQtyVal(row.qty);
                        const currentCost = parseLocaleNumber(row.cost);

                        if (value === row.product.base_unit && row.unit === row.product.bulk_unit_name) {
                            // Bulk -> Base: Multiply Qty, Divide Cost (and round UP)
                            updatedRow.qty = currentQty * conversion;
                            updatedRow.cost = formatPriceInput(Math.ceil(currentCost / conversion));
                        } else if (value === row.product.bulk_unit_name && row.unit === row.product.base_unit) {
                            // Base -> Bulk: Divide Qty, Multiply Cost (and round UP)
                            updatedRow.qty = currentQty / conversion;
                            updatedRow.cost = formatPriceInput(Math.ceil(currentCost * conversion));
                        }
                    }

                    // 2. Reconcile Subtotal based on the (possibly converted) Qty and Cost
                    const q = field === 'qty' ? parseQtyVal(value) : parseQtyVal(updatedRow.qty);

                    const formatPriceVal = (num) => {
                        if (num <= 0) return '';
                        return formatPriceInput(Math.ceil(num));
                    };

                    if (field === 'subtotal') {
                        // User entered Total -> Calculate unit cost (and round UP)
                        const s = parseLocaleNumber(value);
                        if (q > 0) {
                            updatedRow.cost = formatPriceVal(s / q);
                        }
                    } else if (field === 'cost') {
                        const c = parseLocaleNumber(value);
                        updatedRow.subtotal = formatPriceVal(q * c);
                    } else {
                        const c = parseLocaleNumber(updatedRow.cost);
                        updatedRow.subtotal = formatPriceVal(q * c);
                    }

                    return updatedRow;
                }
                return row;
            })
        );
    };

    // Calculate Grand Total
    const grandTotal = rows.reduce((sum, row) => sum + parseLocaleNumber(row.subtotal), 0);

    // Submit Handler
    const handleSubmit = async () => {
        setIsSubmitting(true);
        let uploadedReceiptRef = null;
        let purchaseSaved = false;
        try {
            const validRows = rows.filter((r) => r.product && parseQtyVal(r.qty) > 0);

            if (validRows.length === 0) {
                alert("Silakan tambahkan setidaknya satu item yang valid.");
                setIsSubmitting(false);
                return;
            }

            // Import service dynamically so the modal stays lightweight until opened
            const { purchaseService } = await import('../services/purchaseService');

            // Prepare purchase items
            const purchaseItems = [];
            let grandTotal = 0;

            // Process each row
            for (const row of validRows) {
                const { product, qty, unit, cost } = row;
                const cleanCost = parsePrice(cost);

                const baseUnitLower = (product.base_unit || "").toLowerCase().trim();
                const bulkUnitLower = (product.bulk_unit_name || "").toLowerCase().trim();
                const isSameUnit = baseUnitLower && bulkUnitLower && baseUnitLower === bulkUnitLower;
                const isBulkSelection = unit === product.bulk_unit_name && !isSameUnit;
                const totalCost = Math.ceil(cleanCost * parseQtyVal(qty));

                // Add to purchase items
                purchaseItems.push({
                    product_id: product.id || product.sku,
                    product_name: product.name,
                    qty: parseQtyVal(qty),
                    unit: unit,
                    unit_kind: isBulkSelection ? 'bulk' : 'base',
                    cost_per_unit: cleanCost,
                    total: totalCost
                });

                grandTotal += totalCost;
            }

            // Upload receipt file if exists
            let receiptFileUrl = null;
            if (receiptFile) {
                try {
                    const safeName = receiptFile.name.replace(/[^a-zA-Z0-9.-]/g, '_');
                    const storageRef = ref(storage, `receipts/${Date.now()}_${safeName}`);
                    const uploadResult = await uploadBytes(storageRef, receiptFile);
                    uploadedReceiptRef = uploadResult.ref;
                    receiptFileUrl = await getDownloadURL(uploadResult.ref);
                } catch (storageError) {
                    if (uploadedReceiptRef) {
                        await deleteObject(uploadedReceiptRef).catch(cleanupError => {
                            console.error("Error cleaning up failed receipt upload:", cleanupError);
                        });
                    }
                    console.error("Error uploading receipt to Firebase Storage:", storageError);
                    alert("Gagal mengupload file nota ke cloud storage. Transaksi dibatalkan. Detail: " + storageError.message);
                    setIsSubmitting(false);
                    return;
                }
            }

            // Save purchase record
            await purchaseService.createPurchase({
                items: purchaseItems,
                grand_total: grandTotal,
                supplier_name: supplierName || 'N/A',
                receipt_file: receiptFileUrl || null
            });
            purchaseSaved = true;

            // Clear draft on successful submit
            localStorage.removeItem("purchase_draft_rows");
            localStorage.removeItem("purchase_draft_supplier");
            setRows([
                { id: uuidv4(), product: null, qty: "", unit: "", cost: "", subtotal: "" },
                { id: uuidv4(), product: null, qty: "", unit: "", cost: "", subtotal: "" },
                { id: uuidv4(), product: null, qty: "", unit: "", cost: "", subtotal: "" },
            ]);
            setSupplierName("");
            setReceiptFile(null);

            onSuccess();
            onClose();
        } catch (error) {
            if (uploadedReceiptRef && !purchaseSaved) {
                await deleteObject(uploadedReceiptRef).catch(cleanupError => {
                    console.error("Error cleaning up orphaned receipt:", cleanupError);
                });
            }
            console.error("Error adding stock:", error);
            alert(`Gagal menambah stok. ${error.message || ''}`.trim());
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
                                    <td className="p-2" ref={el => dropdownRefs.current[row.id] = el}>
                                        <input
                                            ref={el => inputRefs.current[row.id] = el}
                                            type="text"
                                            autoComplete="off"
                                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 outline-none transition"
                                            placeholder="Cari produk..."
                                            value={row.product ? row.product.name : (searchQuery[row.id] || "")}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                setSearchQuery({ ...searchQuery, [row.id]: val });
                                                setShowDropdown({ [row.id]: true });
                                                updateDropdownPos(row.id);
                                                // If there was a product selected, clear it so they can search again
                                                if (row.product) {
                                                    updateRow(row.id, "product", null);
                                                    setSearchQuery({ ...searchQuery, [row.id]: val });
                                                }
                                            }}
                                            onFocus={() => {
                                                setShowDropdown({ [row.id]: true });
                                                updateDropdownPos(row.id);
                                                // Pre-fill query if product exists to allow editing
                                                if (row.product && !searchQuery[row.id]) {
                                                    setSearchQuery({ ...searchQuery, [row.id]: row.product.name });
                                                }
                                            }}
                                        />

                                        {/* Dropdown - rendered via portal to escape overflow clipping */}
                                        {showDropdown[row.id] && !row.product && dropdownPos[row.id] && createPortal(
                                            <div
                                                ref={portalRef}
                                                className="bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 list-none shadow-xl rounded-lg max-h-48 overflow-auto"
                                                style={{
                                                    position: 'fixed',
                                                    top: dropdownPos[row.id].top,
                                                    left: dropdownPos[row.id].left,
                                                    width: dropdownPos[row.id].width,
                                                    zIndex: 9999,
                                                }}
                                                onMouseDown={(e) => e.preventDefault()}
                                            >
                                                {getFilteredProducts(searchQuery[row.id] || "")
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
                                                {getFilteredProducts(searchQuery[row.id] || "").length === 0 && (
                                                    <div className="px-4 py-2 text-sm text-gray-500">Tidak ada produk ditemukan</div>
                                                )}
                                            </div>,
                                            document.body
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
                                            step="any"
                                            min="0"
                                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 outline-none focus:ring-2 focus:ring-blue-500 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            value={row.qty}
                                            onChange={(e) => updateRow(row.id, "qty", e.target.value)}
                                            onWheel={(e) => e.target.blur()}
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
                                                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg pl-9 pr-3 py-2 bg-white dark:bg-gray-700 outline-none focus:ring-2 focus:ring-blue-500 text-center"
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
                                                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg pl-9 pr-3 py-2 bg-gray-50 dark:bg-gray-800/50 outline-none focus:ring-2 focus:ring-blue-500 text-center font-medium text-gray-700 dark:text-gray-300"
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
