import { db } from "../src/firebase.config.js";
import { collection, getDocs, doc, updateDoc } from "firebase/firestore";

const PRODUCTS_COLLECTION = "products"; // This might differ based on staging, but usually it's the primary one we want to clean up

async function migrate() {
    const querySnapshot = await getDocs(collection(db, PRODUCTS_COLLECTION));
    console.log(`Found ${querySnapshot.size} products.`);

    for (const d of querySnapshot.docs) {
        const product = d.data();
        const name = (product.name || "").toLowerCase();
        let category = "Lainnya";

        if (name.includes("beras")) {
            category = "Beras";
        } else if (name.includes("minyak") || name.includes("mentega") || name.includes("blue band")) {
            category = "Minyak, Mentega & Lemak";
        } else if (name.includes("tepung") || name.includes("panir") || name.includes("tapioka") || name.includes("terigu")) {
            category = "Tepung-Tepungan";
        } else if (name.includes("saos") || name.includes("kecap") || name.includes("sambal") || name.includes("saori")) {
            category = "Saus, Kecap & Sambal";
        } else if (
            name.includes("gula") ||
            name.includes("garam") ||
            name.includes("kaldu") ||
            name.includes("totole") ||
            name.includes("santan") ||
            name.includes("kara") ||
            name.includes("sasa") ||
            name.includes("fiber creme") ||
            name.includes("powder")
        ) {
            category = "Bumbu & Bahan Masak";
        }

        console.log(`Categorizing: "${product.name}" -> ${category}`);

        const productRef = doc(db, PRODUCTS_COLLECTION, d.id);
        await updateDoc(productRef, { category });
    }

    console.log("Migration complete!");
}

migrate().catch(console.error);
