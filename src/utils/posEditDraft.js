export const POS_EDIT_STORAGE_KEY = 'pos_edit_transaction';

export const readPosEditDraft = () => {
    try {
        const raw = localStorage.getItem(POS_EDIT_STORAGE_KEY);
        if (!raw) return null;
        const draft = JSON.parse(raw);
        if (!draft?.transaction_id || draft.transaction_type !== 'sale' || !Array.isArray(draft.items)) {
            return null;
        }
        return draft;
    } catch {
        return null;
    }
};

export const clearPosEditDraft = () => {
    localStorage.removeItem(POS_EDIT_STORAGE_KEY);
};
