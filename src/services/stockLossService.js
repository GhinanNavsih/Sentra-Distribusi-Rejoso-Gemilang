import { db } from "../firebase.config";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { getCollectionName } from "../utils/envMode";

export const stockLossService = {
    /**
     * Record a stock loss event
     * @param {Object} lossData - { product_id, product_name, qty, reason, cost_price }
     */
    createLoss: async (lossData) => {
        void lossData;
        throw new Error("Pencatatan kehilangan stok langsung dinonaktifkan. Gunakan penyesuaian stok atomik.");
    },

    /**
     * Get all stock losses
     */
    getAllLosses: async () => {
        const COLLECTION_NAME = getCollectionName("stock_losses");
        try {
            const q = query(collection(db, COLLECTION_NAME), orderBy("created_at", "desc"));
            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error("Error fetching stock losses:", error);
            throw error;
        }
    }
};
