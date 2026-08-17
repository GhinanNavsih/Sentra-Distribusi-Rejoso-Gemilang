import { db } from "../firebase.config";
import { collection, getDocs } from "firebase/firestore";
import { getCollectionName } from "../utils/envMode";
import { callInventoryOperation } from './inventoryOperationsService';

/**
 * Links between SDRG products and inventory items in the linked POS.
 *
 * The POS's item names are read live by a Cloud Function using a
 * service-account credential (see functions/index.js) -- this app never holds
 * a POS credential of any kind. Links written here are defaults; the POS may
 * override any of them locally.
 */
export const posLinkService = {
    /** Item names read live from POS. */
    getCatalog: async () => {
        const result = await callInventoryOperation('listPosInventory', {});
        return (result.items || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    },

    getLinks: async () => {
        const snapshot = await getDocs(collection(db, getCollectionName('pos_product_links')));
        return Object.fromEntries(
            snapshot.docs.map(d => [d.id, { ...d.data(), id: d.id }])
        );
    },

    saveLink: async (productId, inventoryItemId) => {
        await callInventoryOperation('savePosProductLink', {
            product_id: productId,
            inventory_item_id: inventoryItemId
        });
    },

    removeLink: async (productId) => {
        await callInventoryOperation('deletePosProductLink', { product_id: productId });
    },

    /**
     * Suggests a POS item for a product by normalised name.
     *
     * Only an unambiguous match is returned, and it is always presented for
     * confirmation rather than saved automatically: a wrong link moves stock to
     * the wrong item silently, which is worse than leaving a product unlinked.
     */
    suggest: (productName, catalog) => {
        const target = normalize(productName);
        if (!target) return null;
        const matches = catalog.filter(item => normalize(item.name) === target);
        return matches.length === 1 ? matches[0].id : null;
    }
};

const normalize = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
