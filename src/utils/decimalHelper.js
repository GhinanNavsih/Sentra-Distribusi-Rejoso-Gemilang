/**
 * Robustly parses a formatted number string into a standard float.
 * Handles both Indonesian (comma as decimal separator, dot as thousands separator)
 * and English (dot as decimal separator, comma as thousands separator) formats.
 * 
 * @param {string | number} val 
 * @returns {number}
 */
export function parseLocaleNumber(val) {
    if (val === undefined || val === null || val === '') return 0;
    if (typeof val === 'number') return val;
    
    let str = val.toString().trim();
    // Remove any characters that are not digits, dot, comma, or minus sign
    str = str.replace(/[^0-9.,-]/g, '');
    
    const hasDot = str.includes('.');
    const hasComma = str.includes(',');
    
    if (hasDot && hasComma) {
        const lastDot = str.lastIndexOf('.');
        const lastComma = str.lastIndexOf(',');
        if (lastComma > lastDot) {
            // Indonesian style: 1.250,50 -> remove dots, replace comma with dot
            str = str.replace(/\./g, '').replace(/,/g, '.');
        } else {
            // English style: 1,250.50 -> remove commas
            str = str.replace(/,/g, '');
        }
    } else if (hasDot) {
        const lastDot = str.lastIndexOf('.');
        const count = str.length - 1 - lastDot;
        if (count >= 3) {
            // Treat as thousands separator: 12.500 -> 12500
            str = str.replace(/\./g, '');
        } else {
            // Treat as decimal separator: 12.5 -> 12.5
        }
    } else if (hasComma) {
        const lastComma = str.lastIndexOf(',');
        const count = str.length - 1 - lastComma;
        if (count >= 3) {
            // Treat as thousands separator: 12,500 -> 12500
            str = str.replace(/,/g, '');
        } else {
            // Treat as decimal separator: 12,5 -> 12.5
            str = str.replace(/,/g, '.');
        }
    }
    
    const num = Number(str);
    return isNaN(num) ? 0 : num;
}

/**
 * Parses a price string and rounds it up to the nearest integer.
 * 
 * @param {string | number} val 
 * @returns {number}
 */
export function parsePrice(val) {
    return Math.ceil(parseLocaleNumber(val));
}

/**
 * Formats a value as the user types it, keeping the decimal separator intact
 * for user entry, while formatting the integer part with dot thousands separator (id-ID style).
 * 
 * @param {string | number} value 
 * @returns {string}
 */
export function formatPriceInput(value) {
    if (value === undefined || value === null || value === '') return '';
    
    // Strip all non-digits
    const clean = value.toString().replace(/\D/g, '');
    if (clean === '') return '';
    
    return Number(clean).toLocaleString('id-ID');
}
