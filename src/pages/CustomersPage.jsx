import React, { useCallback, useEffect, useState } from 'react';
import { customerService } from '../services/customerService';
import PosProductLinks from '../components/PosProductLinks';
import { useUserRole } from '../hooks/useUserRole';

const TIER_LABELS = {
    regular: 'Reguler',
    premium: 'Premium',
    star: 'Bintang'
};

const TIER_STYLES = {
    regular: 'bg-blue-100 text-blue-800',
    premium: 'bg-yellow-100 text-yellow-800',
    star: 'bg-purple-100 text-purple-800'
};

// Keys of BRIDGE_TARGETS in functions/index.js. A target that does not exist
// there is rejected server-side, so this list stays short on purpose.
const BRIDGE_TARGETS = [
    { value: '', label: 'Tidak tersambung' },
    { value: 'canteen375', label: 'Canteen375 (POS kantin)' }
];

function TabHeader({ tab, setTab }) {
    const tabs = [
        { id: 'customers', label: 'Pelanggan' },
        { id: 'links', label: 'Tautan Produk' }
    ];
    return (
        <div className="flex gap-1 border-b border-gray-200">
            {tabs.map(entry => (
                <button
                    key={entry.id}
                    onClick={() => setTab(entry.id)}
                    className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${tab === entry.id
                        ? 'border-primary text-primary'
                        : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                >
                    {entry.label}
                </button>
            ))}
        </div>
    );
}

const emptyDraft = {
    id: null,
    name: '',
    default_customer_type: 'regular',
    bridge_target: ''
};

export default function CustomersPage() {
    const { isSuperAdmin, loading: roleLoading } = useUserRole();
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [draft, setDraft] = useState(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [tab, setTab] = useState('customers');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setCustomers(await customerService.getAllCustomers({ includeArchived: true }));
            setError('');
        } catch (err) {
            setError(err.message || 'Gagal memuat pelanggan.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleSave = async (e) => {
        e.preventDefault();
        if (!draft.name.trim()) {
            setError('Nama pelanggan wajib diisi.');
            return;
        }
        setSaving(true);
        try {
            await customerService.saveCustomer({
                customer_id: draft.id,
                name: draft.name.trim(),
                default_customer_type: draft.default_customer_type,
                bridge_target: draft.bridge_target || null
            });
            setDraft(null);
            setError('');
            await load();
        } catch (err) {
            setError(err.message || 'Gagal menyimpan pelanggan.');
        } finally {
            setSaving(false);
        }
    };

    const handleArchive = async (customer) => {
        if (!confirm(`Arsipkan ${customer.name}? Pesanan yang sudah tercatat tidak berubah.`)) return;
        try {
            await customerService.archiveCustomer(customer.id);
            await load();
        } catch (err) {
            setError(err.message || 'Gagal mengarsipkan pelanggan.');
        }
    };

    if (roleLoading) return <p className="text-gray-500">Memuat…</p>;

    if (!isSuperAdmin) {
        return (
            <div className="rounded-lg border border-gray-200 bg-white p-6 text-center">
                <p className="font-bold text-gray-800">Khusus superadmin</p>
                <p className="mt-1 text-sm text-gray-500">
                    Pengelolaan pelanggan terdaftar hanya dapat diakses oleh superadmin.
                </p>
            </div>
        );
    }

    if (tab === 'links') {
        return (
            <div className="space-y-6">
                <TabHeader tab={tab} setTab={setTab} />
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">Tautan Produk</h2>
                    <p className="text-sm text-gray-500">
                        Menghubungkan produk SDRG dengan bahan di aplikasi POS, agar penjualan
                        yang diterima menambah stok bahan yang tepat.
                    </p>
                </div>
                <PosProductLinks />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <TabHeader tab={tab} setTab={setTab} />
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">Pelanggan Terdaftar</h2>
                    <p className="text-sm text-gray-500">
                        Pembeli tetap yang dipilih di kasir. Pelanggan yang tersambung akan
                        mengirim penjualan lunasnya ke sistem stok mereka.
                    </p>
                </div>
                <button
                    onClick={() => { setDraft({ ...emptyDraft }); setError(''); }}
                    className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white shadow-sm hover:opacity-90"
                >
                    + Tambah
                </button>
            </div>

            {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                    {error}
                </div>
            )}

            {draft && (
                <form onSubmit={handleSave} className="rounded-lg border-2 border-primary/30 bg-white p-4 space-y-4">
                    <p className="font-bold text-gray-800">
                        {draft.id ? 'Ubah Pelanggan' : 'Pelanggan Baru'}
                    </p>

                    <div>
                        <label className="block text-xs font-medium text-gray-500">Nama</label>
                        <input
                            value={draft.name}
                            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                            placeholder="mis. Canteen375"
                            maxLength={120}
                            autoFocus
                            className="mt-1 w-full rounded-md border-2 border-gray-300 px-3 py-2 text-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-gray-500">Tingkat Harga Bawaan</label>
                        <div className="mt-1 flex gap-2">
                            {Object.entries(TIER_LABELS).map(([tier, label]) => (
                                <button
                                    key={tier}
                                    type="button"
                                    onClick={() => setDraft({ ...draft, default_customer_type: tier })}
                                    className={`flex-1 rounded-md border-2 py-2 text-sm font-medium transition-all ${draft.default_customer_type === tier
                                        ? 'border-primary bg-primary text-white shadow-sm'
                                        : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-gray-500">Sinkronisasi Stok</label>
                        <select
                            value={draft.bridge_target}
                            onChange={(e) => setDraft({ ...draft, bridge_target: e.target.value })}
                            className="mt-1 w-full rounded-md border-2 border-gray-300 px-3 py-2 text-sm"
                        >
                            {BRIDGE_TARGETS.map(target => (
                                <option key={target.value} value={target.value}>{target.label}</option>
                            ))}
                        </select>
                        {draft.bridge_target && (
                            <p className="mt-2 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-700">
                                Setiap penjualan lunas ke pelanggan ini akan dikirim ke sistem stok
                                mereka untuk dikonfirmasi. Pre-order baru terkirim setelah dilunasi.
                            </p>
                        )}
                    </div>

                    <div className="flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => { setDraft(null); setError(''); }}
                            className="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
                        >
                            Batal
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
                        >
                            {saving ? 'Menyimpan…' : 'Simpan'}
                        </button>
                    </div>
                </form>
            )}

            {loading ? (
                <p className="text-gray-500">Memuat pelanggan…</p>
            ) : customers.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
                    <p className="font-medium text-gray-700">Belum ada pelanggan terdaftar.</p>
                    <p className="mt-1 text-sm text-gray-500">
                        Penjualan tanpa pelanggan terdaftar tetap berjalan seperti biasa.
                    </p>
                </div>
            ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                            <tr>
                                <th className="px-4 py-3">Nama</th>
                                <th className="px-4 py-3">Tingkat Harga</th>
                                <th className="px-4 py-3">Sinkronisasi Stok</th>
                                <th className="px-4 py-3"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {customers.map(customer => {
                                const archived = customer.active === false;
                                const tier = customer.default_customer_type || 'regular';
                                return (
                                    <tr key={customer.id} className={archived ? 'opacity-50' : ''}>
                                        <td className="px-4 py-3">
                                            <span className="font-medium text-gray-900">{customer.name}</span>
                                            {archived && (
                                                <span className="ml-2 text-xs text-gray-500">(diarsipkan)</span>
                                            )}
                                            <div className="font-mono text-xs text-gray-400">{customer.id}</div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TIER_STYLES[tier]}`}>
                                                {TIER_LABELS[tier]}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            {customer.bridge_target ? (
                                                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                                                    {customer.bridge_target}
                                                </span>
                                            ) : (
                                                <span className="text-xs text-gray-400">—</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right whitespace-nowrap">
                                            {!archived && (
                                                <>
                                                    <button
                                                        onClick={() => {
                                                            setDraft({
                                                                id: customer.id,
                                                                name: customer.name || '',
                                                                default_customer_type: tier,
                                                                bridge_target: customer.bridge_target || ''
                                                            });
                                                            setError('');
                                                        }}
                                                        className="rounded-md px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
                                                    >
                                                        Ubah
                                                    </button>
                                                    <button
                                                        onClick={() => handleArchive(customer)}
                                                        className="rounded-md px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                                                    >
                                                        Arsipkan
                                                    </button>
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
