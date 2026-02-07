import { db } from "../firebase.config";
import { collection, doc, serverTimestamp, setDoc, getDocs, query, orderBy } from "firebase/firestore";
import { getCollectionName } from "../utils/envMode";

export const stockLossService = {
    /**
     * Record a stock loss event
     * @param {Object} lossData - { product_id, product_name, qty, reason, cost_price }
     */
    createLoss: async (lossData) => {
        const COLLECTION_NAME = getCollectionName("stock_losses");
        try {
            const now = new Date();
            const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
            const lossId = `LOSS-${dateStr}-${timeStr}-${lossData.product_id}`;

            const lossRef = doc(db, COLLECTION_NAME, lossId);
            await setDoc(lossRef, {
                ...lossData,
                id: lossId,
                created_at: serverTimestamp()
            });

            return lossId;
        } catch (error) {
            console.error("Error recording stock loss:", error);
            throw error;
        }
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
