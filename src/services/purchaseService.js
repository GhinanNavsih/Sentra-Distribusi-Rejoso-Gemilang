import { db } from "../firebase.config";
import { collection, doc, serverTimestamp, setDoc, getDocs, query, orderBy } from "firebase/firestore";
import { getCollectionName } from "../utils/envMode";

// Helper to get today's date string YYYY-MM-DD
const getTodayDateString = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

export const purchaseService = {
    /**
     * Create a new purchase record
     * @param {Object} purchaseData - { items, grand_total, supplier_name, receipt_file }
     */
    createPurchase: async (purchaseData) => {
        const COLLECTION_NAME = getCollectionName("purchases");
        const COUNTER_COLLECTION = getCollectionName("counters");
        try {
            // Generate unique purchase ID
            const dateStr = getTodayDateString();
            const counterRef = doc(db, COUNTER_COLLECTION, `purchases_${dateStr}`);

            // Get current count
            const counterSnap = await getDocs(query(collection(db, COUNTER_COLLECTION)));
            let nextCount = 1;

            const existingCounter = counterSnap.docs.find(d => d.id === `purchases_${dateStr}`);
            if (existingCounter) {
                nextCount = existingCounter.data().count + 1;
            }

            // Format: PUR-2026-02-07-0001
            const countStr = String(nextCount).padStart(4, '0');
            const newPurchaseId = `PUR-${dateStr}-${countStr}`;

            // Create purchase record
            const purchaseRef = doc(db, COLLECTION_NAME, newPurchaseId);
            await setDoc(purchaseRef, {
                ...purchaseData,
                id: newPurchaseId,
                created_at: serverTimestamp()
            });

            // Update counter
            await setDoc(counterRef, { count: nextCount }, { merge: true });

            return newPurchaseId;
        } catch (error) {
            console.error("Error creating purchase:", error);
            throw error;
        }
    },

    /**
     * Get all purchases
     */
    getAllPurchases: async () => {
        const COLLECTION_NAME = getCollectionName("purchases");
        try {
            const q = query(collection(db, COLLECTION_NAME), orderBy("created_at", "desc"));
            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error("Error fetching purchases:", error);
            throw error;
        }
    }
};
