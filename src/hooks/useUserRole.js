import { useState, useEffect } from 'react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.config';
import { useAuth } from '../context/AuthContext';

export function useUserRole() {
    const { currentUser } = useAuth();
    const [role, setRole] = useState(null); // 'superadmin', 'shopper', or null/undefined
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!currentUser) {
            setRole(null);
            setLoading(false);
            return;
        }

        const collectionName = 'users'; // Shared across production and staging
        const userRef = doc(db, collectionName, currentUser.uid);

        // Real-time listener for role changes
        const unsubscribe = onSnapshot(userRef, (docSnap) => {
            if (docSnap.exists()) {
                const userData = docSnap.data();
                // Default to 'shopper' if role is missing but user exists
                setRole(userData.role || 'shopper');
            } else {
                // If user document doesn't exist, treat as shopper (safe default)
                // In a real app, you might want to create the doc here or handle differently
                console.log("User document not found, defaulting to shopper role");
                setRole('shopper');
            }
            setLoading(false);
        }, (error) => {
            console.error("Error fetching user role:", error);
            // Fallback to shopper on error to prevent unauthorized access
            setRole('shopper');
            setLoading(false);
        });

        return () => unsubscribe();
    }, [currentUser]);

    return {
        role,
        loading,
        isSuperAdmin: role === 'superadmin',
        isShopper: role === 'shopper'
    };
}
