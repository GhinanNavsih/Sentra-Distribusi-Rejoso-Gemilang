import { db } from "../firebase.config";
import { collection, doc, setDoc, getDoc, getDocs, deleteDoc } from "firebase/firestore";

const COLLECTION_NAME = "products";

export const productService = {
    /**
     * Create or Update a Product
     * Uses SKU as Document ID to ensure uniqueness
     * @param {Object} productData - { sku, name, base_unit, bulk_unit_name, bulk_unit_conversion, price_tiers }
     */
    saveProduct: async (productData) => {
        const { sku } = productData;
        if (!sku) throw new Error("SKU is required");

        // Ensure numbers
        if (productData.bulk_unit_conversion) productData.bulk_unit_conversion = Number(productData.bulk_unit_conversion);

        const productRef = doc(db, COLLECTION_NAME, sku);
        // Merge true allows updating existing product without wiping other fields
        await setDoc(productRef, productData, { merge: true });
        return sku;
    },

    /**
     * Delete a product by SKU
     */
    deleteProduct: async (sku) => {
        if (!sku) return;
        const productRef = doc(db, COLLECTION_NAME, sku);
        await deleteDoc(productRef);
    },

    /**
     * Fetch all products
     */
    getAllProducts: async () => {
        const snapshot = await getDocs(collection(db, COLLECTION_NAME));
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    /**
     * Get single product by SKU
     */
    getProductBySku: async (sku) => {
        const docRef = doc(db, COLLECTION_NAME, sku);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            return { id: docSnap.id, ...docSnap.data() };
        }
        return null;
    },

    /**
     * Calculate unit price based on validation logic
     * Logic: "If qty < 10, price is X. If qty >= 10, price is Y."
     * Assumes price_tiers is [{ min_qty: number, price: number }]
     */
    calculatePrice: (product, qty) => {
        if (!product.price_tiers || !Array.isArray(product.price_tiers) || product.price_tiers.length === 0) {
            return 0;
        }

        // Sort by min_qty descending (largest requirement first)
        // e.g. Tiers: 1->15000, 10->14000
        // Qty 5: Check 10 (Fail), Check 1 (Pass) -> Price 15000
        // Qty 15: Check 10 (Pass) -> Price 14000
        const sortedTiers = [...product.price_tiers].sort((a, b) => b.min_qty - a.min_qty);
        const activeTier = sortedTiers.find(t => qty >= t.min_qty);

        return activeTier ? activeTier.price : sortedTiers[sortedTiers.length - 1].price;
    }
};
