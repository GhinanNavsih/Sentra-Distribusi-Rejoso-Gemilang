const STORAGE_KEY = 'app_env_mode';

/**
 * Get the current environment mode from localStorage.
 * @returns {'production' | 'staging'}
 */
export function getEnvMode() {
    try {
        const mode = localStorage.getItem(STORAGE_KEY);
        return mode === 'staging' ? 'staging' : 'production';
    } catch {
        return 'production';
    }
}

/**
 * Set the environment mode in localStorage.
 * @param {'production' | 'staging'} mode
 */
export function setEnvMode(mode) {
    try {
        localStorage.setItem(STORAGE_KEY, mode);
    } catch {
        // Ignore storage errors
    }
}

/**
 * Returns true if currently in staging mode.
 * @returns {boolean}
 */
export function isStaging() {
    return getEnvMode() === 'staging';
}

/**
 * Returns the correct Firestore collection name based on the current environment mode.
 * In staging mode, appends "_test" to the collection name.
 * @param {string} baseCollectionName - The production collection name (e.g. "products")
 * @returns {string} - The resolved collection name (e.g. "products" or "products_test")
 */
export function getCollectionName(baseCollectionName) {
    return isStaging() ? `${baseCollectionName}_test` : baseCollectionName;
}
