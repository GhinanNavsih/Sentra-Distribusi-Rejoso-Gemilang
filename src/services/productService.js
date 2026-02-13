import { db } from "../firebase.config";
import { collection, doc, setDoc, getDoc, getDocs, deleteDoc, updateDoc } from "firebase/firestore";
import { getCollectionName } from "../utils/envMode";

export const PRODUCT_CATEGORIES = [
    "Beras",
    "Minyak, Mentega & Lemak",
    "Tepung",
    "Saus, Kecap & Sambal",
    "Bumbu & Bahan Masak",
    "Lainnya"
];

export const productService = {
    /**
     * Create or Update a Product
     * Uses SKU as Document ID to ensure uniqueness
     * @param {Object} productData - { sku, name, base_unit, bulk_unit_name, bulk_unit_conversion, price_tiers }
     */
    saveProduct: async (productData) => {
        const col = getCollectionName("products");
        const { sku } = productData;
        if (!sku) throw new Error("SKU diperlukan");

        // Ensure numbers
        if (productData.bulk_unit_conversion) productData.bulk_unit_conversion = Number(productData.bulk_unit_conversion);

        const productRef = doc(db, col, sku);
        // Merge true allows updating existing product without wiping other fields
        await setDoc(productRef, productData, { merge: true });
        return sku;
    },

    /**
     * Delete a product by SKU
     */
    deleteProduct: async (sku) => {
        const col = getCollectionName("products");
        if (!sku) return;
        const productRef = doc(db, col, sku);
        await deleteDoc(productRef);
    },

    /**
     * Fetch all products
     */
    getAllProducts: async () => {
        const col = getCollectionName("products");
        const snapshot = await getDocs(collection(db, col));
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    /**
     * Get single product by SKU
     */
    getProductBySku: async (sku) => {
        const col = getCollectionName("products");
        const docRef = doc(db, col, sku);
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
    calculatePrice: (product, customerType = 'regular') => {
        // Default to 0 if product is invalid
        if (!product) return 0;

        // Normalize customer type
        const type = customerType.toLowerCase();

        // Return specific price based on type
        if (type === 'star') return Number(product.price_star || 0);
        if (type === 'premium') return Number(product.price_premium || 0);

        // Default to Regular price
        return Number(product.price_regular || 0);
    },

    /**
     * Automatically converts Google Drive sharing links to direct image links
     * @param {string} url 
     * @returns {string} transformed url
     */
    transformDriveUrl: (url) => {
        if (!url || typeof url !== 'string') return url;
        if (url.includes('drive.google.com')) {
            // Extract the ID from /file/d/ID/view or ?id=ID
            const driveId = url.split('/d/')[1]?.split('/')[0] || url.split('id=')[1]?.split('&')[0];
            if (driveId) {
                // Use the thumbnail endpoint which is much more reliable for embedding in <img> tags
                return `https://drive.google.com/thumbnail?id=${driveId}&sz=w1000`;
            }
        }
        return url;
    },

    /**
     * Determine category based on product name
     */
    getCategoryByName: (name = "") => {
        const n = name.toLowerCase();
        if (n.includes("beras")) return "Beras";
        if (n.includes("minyak") || n.includes("mentega") || n.includes("blue band")) return "Minyak, Mentega & Lemak";
        if (n.includes("tepung") || n.includes("panir") || n.includes("tapioka") || n.includes("terigu")) return "Tepung-Tepungan";
        if (n.includes("saos") || n.includes("kecap") || n.includes("sambal") || n.includes("saori")) return "Saus, Kecap & Sambal";
        if (
            n.includes("gula") ||
            n.includes("garam") ||
            n.includes("kaldu") ||
            n.includes("totole") ||
            n.includes("santan") ||
            n.includes("kara") ||
            n.includes("sasa") ||
            n.includes("fiber creme") ||
            n.includes("powder")
        ) return "Bumbu & Bahan Masak";
        return "Lainnya";
    },

    /**
     * Migration helper to categorize all existing products
     */
    migrateCategories: async () => {
        const col = getCollectionName("products");
        const snapshot = await getDocs(collection(db, col));
        const updates = snapshot.docs.map(async (d) => {
            const product = d.data();
            if (!product.category || product.category === 'Lainnya') {
                const category = productService.getCategoryByName(product.name);
                if (category !== 'Lainnya') {
                    const productRef = doc(db, col, d.id);
                    await updateDoc(productRef, { category });
                }
            }
        });
        await Promise.all(updates);
    }
};
