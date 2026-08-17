import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { productService } from '../services/productService';
import { posLinkService } from '../services/posLinkService';

const sameUnit = (a, b) =>
    String(a || '').toLowerCase().trim() === String(b || '').toLowerCase().trim();

/**
 * Maps inventory items in the linked POS onto SDRG products.
 *
 * One row per POS bahan — the shorter, more stable list — with a search box
 * to find and attach the SDRG product(s) that supply it. POS item names are
 * read live by a Cloud Function using a service-account credential; this page
 * never holds a POS credential itself. Links saved here are defaults that the
 * POS may override locally.
 */
export default function PosProductLinks() {
    const [products, setProducts] = useState([]);
    const [catalog, setCatalog] = useState([]);
    const [links, setLinks] = useState({});
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [onlyUnlinked, setOnlyUnlinked] = useState(false);
    const [busyPosItemId, setBusyPosItemId] = useState(null);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [productList, catalogList, linkMap] = await Promise.all([
                productService.getAllProducts(),
                posLinkService.getCatalog(),
                posLinkService.getLinks()
            ]);
            setProducts(productList);
            setCatalog(catalogList);
            setLinks(linkMap);
            setError('');
        } catch (err) {
            setError(err.message || 'Gagal memuat data tautan.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const productById = useMemo(
        () => Object.fromEntries(products.map(p => [p.id, p])),
        [products]
    );

    // POS item id -> SDRG products linked to it. A product can only be linked
    // to one POS item at a time (the link doc is keyed by product ID), but a
    // POS item can have several products supplying it.
    const linksByPosItem = useMemo(() => {
        const map = {};
        Object.values(links).forEach(link => {
            const posItemId = link.inventory_item_id;
            if (!posItemId) return;
            const product = productById[link.sdrg_product_id];
            (map[posItemId] ||= []).push({
                sdrgProductId: link.sdrg_product_id,
                // Prefer the live product record; the link only carries a
                // denormalised snapshot of the name from when it was saved.
                name: product?.name || link.sdrg_product_name || link.sdrg_product_id,
                baseUnit: product?.base_unit ?? link.sdrg_base_unit ?? ''
            });
        });
        return map;
    }, [links, productById]);

    // SDRG product id -> the POS item name it's currently linked to, so the
    // search box can warn before silently moving a product off its old link.
    const linkedElsewhere = useMemo(() => {
        const map = {};
        Object.values(links).forEach(link => {
            if (link.inventory_item_id) {
                map[link.sdrg_product_id] = link.inventory_item_name || link.inventory_item_id;
            }
        });
        return map;
    }, [links]);

    const visible = useMemo(() => {
        const q = search.toLowerCase().trim();
        return catalog
            .filter(item => !q || item.name.toLowerCase().includes(q))
            .filter(item => !onlyUnlinked || !linksByPosItem[item.id]?.length)
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [catalog, search, onlyUnlinked, linksByPosItem]);

    const linkedPosItemCount = catalog.filter(item => linksByPosItem[item.id]?.length).length;

    const handleLink = async (posItemId, sdrgProductId) => {
        setBusyPosItemId(posItemId);
        setError('');
        try {
            await posLinkService.saveLink(sdrgProductId, posItemId);
            setLinks(await posLinkService.getLinks());
        } catch (err) {
            setError(err.message || 'Gagal menyimpan tautan.');
        } finally {
            setBusyPosItemId(null);
        }
    };

    const handleUnlink = async (posItemId, sdrgProductId) => {
        setBusyPosItemId(posItemId);
        setError('');
        try {
            await posLinkService.removeLink(sdrgProductId);
            setLinks(await posLinkService.getLinks());
        } catch (err) {
            setError(err.message || 'Gagal melepas tautan.');
        } finally {
            setBusyPosItemId(null);
        }
    };

    if (loading) return <p className="text-gray-500">Memuat tautan produk…</p>;

    if (catalog.length === 0) {
        return (
            <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
                <p className="font-medium text-gray-700">Belum ada bahan di Inventory POS.</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
                    Daftar ini dibaca langsung dari aplikasi POS. Tambahkan bahan di sana
                    terlebih dahulu, lalu muat ulang halaman ini.
                </p>
                <button
                    onClick={load}
                    className="mt-4 rounded-md border-2 border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:border-gray-400"
                >
                    Muat ulang
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                    {error}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Cari bahan POS…"
                    className="min-w-[200px] flex-1 rounded-md border-2 border-gray-300 px-3 py-2 text-sm"
                />
                <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input
                        type="checkbox"
                        checked={onlyUnlinked}
                        onChange={(e) => setOnlyUnlinked(e.target.checked)}
                        className="h-4 w-4"
                    />
                    Hanya yang belum ditautkan
                </label>
                <span className="text-sm font-medium text-gray-500">
                    {linkedPosItemCount} / {catalog.length} bahan tertaut
                </span>
            </div>

            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                        <tr>
                            <th className="w-64 px-4 py-3">Bahan di POS</th>
                            <th className="px-4 py-3">Produk SDRG</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {visible.map(item => (
                            <PosItemRow
                                key={item.id}
                                posItem={item}
                                linkedProducts={linksByPosItem[item.id] || []}
                                allProducts={products}
                                linkedElsewhere={linkedElsewhere}
                                busy={busyPosItemId === item.id}
                                onLink={(sdrgProductId) => handleLink(item.id, sdrgProductId)}
                                onUnlink={(sdrgProductId) => handleUnlink(item.id, sdrgProductId)}
                            />
                        ))}
                        {visible.length === 0 && (
                            <tr>
                                <td colSpan={2} className="px-4 py-8 text-center text-sm text-gray-500">
                                    Tidak ada bahan yang cocok.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            <p className="text-xs text-gray-500">
                Tautan di sini menjadi acuan awal. Jika bahan yang sama ditautkan berbeda di
                aplikasi POS, pengaturan POS yang dipakai.
            </p>
        </div>
    );
}

function PosItemRow({ posItem, linkedProducts, allProducts, linkedElsewhere, busy, onLink, onUnlink }) {
    const linkedIds = useMemo(
        () => new Set(linkedProducts.map(p => p.sdrgProductId)),
        [linkedProducts]
    );

    return (
        <tr>
            <td className="px-4 py-3 align-top">
                <div className="font-medium text-gray-900">{posItem.name}</div>
                <div className="text-xs text-gray-500">satuan: {posItem.unit || '—'}</div>
            </td>
            <td className="px-4 py-3">
                <div className="space-y-2">
                    {linkedProducts.map(product => {
                        const unitMismatch = !sameUnit(product.baseUnit, posItem.unit);
                        return (
                            <div key={product.sdrgProductId} className="flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-1 text-xs font-medium text-green-800">
                                    {product.name}
                                    <button
                                        type="button"
                                        onClick={() => onUnlink(product.sdrgProductId)}
                                        disabled={busy}
                                        title="Lepas tautan"
                                        className="ml-1 text-green-700 hover:text-red-600 disabled:opacity-50"
                                    >
                                        ×
                                    </button>
                                </span>
                                {unitMismatch && (
                                    <span className="text-xs text-orange-700">
                                        satuan berbeda ({product.baseUnit || '—'})
                                    </span>
                                )}
                            </div>
                        );
                    })}
                    <ProductSearchSelect
                        options={allProducts}
                        excludeIds={linkedIds}
                        linkedElsewhere={linkedElsewhere}
                        disabled={busy}
                        onSelect={onLink}
                        placeholder={linkedProducts.length ? 'Tautkan produk lain…' : 'Cari produk SDRG…'}
                    />
                </div>
            </td>
        </tr>
    );
}

/** Type-ahead search over SDRG products, used to attach one to a POS row. */
function ProductSearchSelect({ options, excludeIds, linkedElsewhere, disabled, onSelect, placeholder }) {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);

    const filtered = useMemo(() => {
        const q = query.toLowerCase().trim();
        return options
            .filter(option => !excludeIds.has(option.id))
            .filter(option => !q || (option.name || '').toLowerCase().includes(q))
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
            .slice(0, 8);
    }, [options, excludeIds, query]);

    return (
        <div className="relative max-w-sm">
            <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
                onFocus={() => setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                disabled={disabled}
                placeholder={placeholder}
                className="w-full rounded-md border-2 border-gray-300 px-3 py-2 text-sm disabled:opacity-50"
            />
            {open && filtered.length > 0 && (
                <div className="absolute z-10 mt-1 w-full max-h-56 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
                    {filtered.map(option => {
                        const elsewhere = linkedElsewhere[option.id];
                        return (
                            <button
                                key={option.id}
                                type="button"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    onSelect(option.id);
                                    setQuery('');
                                    setOpen(false);
                                }}
                                className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                            >
                                <div className="text-gray-900">{option.name}</div>
                                {elsewhere && (
                                    <div className="text-xs text-orange-600">
                                        sudah tertaut ke {elsewhere} — akan dipindahkan ke sini
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
