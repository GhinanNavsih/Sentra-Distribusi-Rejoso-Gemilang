import { db } from "../firebase.config";
import { collection, doc, serverTimestamp, setDoc, getDocs, query, orderBy } from "firebase/firestore";

const COLLECTION_NAME = "purchases";
const COUNTER_COLLECTION = "counters";

// Helper to get today's date string DD-MM-YY
const getTodayDateString = () => {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
};

export const purchaseService = {
    /**
     * Create a new purchase record
     * @param {Object} purchaseData - { items, grand_total, supplier_name, receipt_file }
     */
    createPurchase: async (purchaseData) => {
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

            // Format: PUR-02-02-26-0001
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
