import { createProductId, PRODUCT_ID_PATTERN } from '../functions/shared/productId.js';

export const PRODUCT_REFERENCE_KEYS = new Set([
  'product_id',
  'sku',
  'from_sku',
  'to_sku',
  'source_product_id',
  'target_product_id'
]);

const nonEmpty = (value) => typeof value === 'string' && value.trim() !== '';

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const productNameKey = (value) => {
  if (!nonEmpty(value)) return '';
  const tokens = String(value).normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return [...new Set(tokens)].sort().join('|');
};

export const documentPathKey = (collectionName, documentId) => `${collectionName}/${documentId}`;

export const collectProductReferences = (value, path = '', inheritedProductName = null, references = []) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectProductReferences(
      item,
      `${path}[${index}]`,
      inheritedProductName,
      references
    ));
    return references;
  }
  if (!value || typeof value !== 'object') return references;

  const localProductName = nonEmpty(value.product_name) ? value.product_name.trim() : inheritedProductName;
  Object.entries(value).forEach(([key, childValue]) => {
    const childPath = path ? `${path}.${key}` : key;
    if (PRODUCT_REFERENCE_KEYS.has(key) && nonEmpty(childValue)) {
      references.push({
        path: childPath,
        value: childValue,
        product_name: localProductName,
        base_unit: value.base_unit,
        unit: value.unit,
        unit_label: value.unit_label,
        bulk_unit_name: value.bulk_unit_name,
        bulk_unit_conversion: value.bulk_unit_conversion
      });
      return;
    }
    if (key !== 'legacy_sku' && key !== 'legacy_product_id') {
      collectProductReferences(childValue, childPath, localProductName, references);
    }
  });
  return references;
};

const productAliases = (document) => [
  document.id,
  document.data.sku,
  document.data.product_id,
  document.data.legacy_sku,
  document.data.legacy_product_id
].filter(nonEmpty).filter((alias, index, aliases) => aliases.indexOf(alias) === index);

export const buildProductMapping = (productDocuments, {
  reservedIds = new Set(),
  suffixFactory
} = {}) => {
  const aliasOwners = new Map();
  const errors = [];

  productDocuments.forEach(document => {
    productAliases(document).forEach(alias => {
      const previous = aliasOwners.get(alias);
      if (previous && previous !== document.id) {
        errors.push({ kind: 'ambiguous-product-alias', alias, products: [previous, document.id] });
      } else {
        aliasOwners.set(alias, document.id);
      }
    });
  });

  const mapping = new Map();
  const assignedIds = new Set();
  const availableIds = new Set(reservedIds);
  const entries = [];

  productDocuments.forEach(document => {
    const data = document.data || {};
    const isMigrated = data.id_migration_version === 1
      && document.id === data.sku
      && PRODUCT_ID_PATTERN.test(document.id);
    let newId = isMigrated ? document.id : null;

    if (!newId) {
      for (let attempt = 0; attempt < 10000; attempt += 1) {
        const candidate = createProductId(data.name, suffixFactory);
        if (!availableIds.has(candidate) && !assignedIds.has(candidate)) {
          newId = candidate;
          break;
        }
      }
    }

    if (!newId) {
      errors.push({ kind: 'id-generation-exhausted', product_id: document.id });
      return;
    }

    assignedIds.add(newId);
    availableIds.add(newId);
    productAliases(document).forEach(alias => mapping.set(alias, newId));
    mapping.set(newId, newId);
    entries.push({
      old_id: document.id,
      new_id: newId,
      name: data.name || '',
      aliases: productAliases(document)
    });
  });

  return { mapping, entries, errors };
};

const setResolution = (reconciliation, occurrence, newId, source) => {
  const documentKey = occurrence.document_path;
  if (!reconciliation.resolutionsByDocument.has(documentKey)) {
    reconciliation.resolutionsByDocument.set(documentKey, new Map());
  }
  reconciliation.resolutionsByDocument.get(documentKey).set(occurrence.path, newId);
  reconciliation.resolutions.push({
    collection: occurrence.collection,
    document_id: occurrence.document_id,
    document_path: documentKey,
    path: occurrence.path,
    old_id: occurrence.value,
    new_id: newId,
    product_name: occurrence.product_name || null,
    source
  });
};

const firstNonEmpty = (...values) => values.find(value => nonEmpty(value))?.trim() || '';

const archivedProductData = (profile, id) => ({
  name: profile.name,
  base_unit: firstNonEmpty(profile.base_unit, profile.unit, profile.unit_label) || 'unknown',
  bulk_unit_name: firstNonEmpty(profile.bulk_unit_name),
  bulk_unit_conversion: Number(profile.bulk_unit_conversion) > 0 ? Number(profile.bulk_unit_conversion) : 1,
  cost_price: 0,
  price_regular: 0,
  price_premium: 0,
  price_star: 0,
  sku: id,
  active: false,
  migration_archived: true,
  archive_reason: 'legacy_product_reference',
  legacy_sku: profile.legacy_id,
  legacy_product_id: profile.legacy_id,
  id_migration_version: 1
});

export const buildHistoricalReconciliation = ({
  historicalDocuments = [],
  products = [],
  mapping = new Map(),
  reservedIds = new Set(),
  suffixFactory
} = {}) => {
  const reconciliation = {
    resolutions: [],
    resolutionsByDocument: new Map(),
    archivedProducts: [],
    errors: []
  };
  const currentByName = new Map();
  const knownTargetsByAlias = new Map();
  const unresolvedWithNames = [];
  const unresolvedWithoutNames = [];

  products.forEach(document => {
    const targetId = mapping.get(document.id);
    const nameKey = productNameKey(document.data?.name);
    if (!targetId || !nameKey) return;
    if (!currentByName.has(nameKey)) currentByName.set(nameKey, new Set());
    currentByName.get(nameKey).add(targetId);
  });

  const addKnownTarget = (legacyId, targetId) => {
    if (!knownTargetsByAlias.has(legacyId)) knownTargetsByAlias.set(legacyId, new Set());
    knownTargetsByAlias.get(legacyId).add(targetId);
  };

  const occurrences = historicalDocuments.flatMap(document => collectProductReferences(
    document.data,
    '',
    null,
    []
  ).map(reference => ({
    ...reference,
    collection: document.collection,
    document_id: document.id,
    document_path: documentPathKey(document.collection, document.id)
  })));

  occurrences.forEach(occurrence => {
    if (mapping.has(occurrence.value)) return;
    const nameKey = productNameKey(occurrence.product_name);
    const candidates = nameKey ? currentByName.get(nameKey) || new Set() : new Set();
    if (candidates.size === 1) {
      const targetId = [...candidates][0];
      addKnownTarget(occurrence.value, targetId);
      setResolution(reconciliation, occurrence, targetId, 'current-product-name');
      return;
    }
    if (candidates.size > 1) {
      reconciliation.errors.push({
        kind: 'ambiguous-historical-product-name',
        path: `${occurrence.document_path}.${occurrence.path}`,
        value: occurrence.value,
        product_name: occurrence.product_name,
        candidates: [...candidates]
      });
      return;
    }
    if (nameKey) unresolvedWithNames.push({ ...occurrence, nameKey });
    else unresolvedWithoutNames.push(occurrence);
  });

  const profiles = new Map();
  unresolvedWithNames.forEach(occurrence => {
    const profileKey = `${occurrence.value}\u0000${occurrence.nameKey}`;
    if (!profiles.has(profileKey)) {
      profiles.set(profileKey, {
        legacy_id: occurrence.value,
        name: occurrence.product_name.trim(),
        base_unit: occurrence.base_unit,
        unit: occurrence.unit,
        unit_label: occurrence.unit_label,
        bulk_unit_name: occurrence.bulk_unit_name,
        bulk_unit_conversion: occurrence.bulk_unit_conversion
      });
    }
  });

  const allocatedIds = new Set([...reservedIds, ...mapping.values()]);
  profiles.forEach((profile, profileKey) => {
    let id = null;
    for (let attempt = 0; attempt < 10000; attempt += 1) {
      const candidate = createProductId(profile.name, suffixFactory);
      if (!allocatedIds.has(candidate)) {
        id = candidate;
        break;
      }
    }
    if (!id) {
      reconciliation.errors.push({ kind: 'legacy-id-generation-exhausted', legacy_id: profile.legacy_id, name: profile.name });
      return;
    }
    allocatedIds.add(id);
    mapping.set(id, id);
    const data = archivedProductData(profile, id);
    reconciliation.archivedProducts.push({ id, data, legacy_id: profile.legacy_id, name: profile.name });
    profiles.set(profileKey, { ...profile, id });
    addKnownTarget(profile.legacy_id, id);
  });

  unresolvedWithNames.forEach(occurrence => {
    const profileKey = `${occurrence.value}\u0000${occurrence.nameKey}`;
    const profile = profiles.get(profileKey);
    if (profile?.id) setResolution(reconciliation, occurrence, profile.id, 'archived-product');
  });

  unresolvedWithoutNames.forEach(occurrence => {
    const candidates = knownTargetsByAlias.get(occurrence.value) || new Set();
    if (candidates.size === 1) {
      setResolution(reconciliation, occurrence, [...candidates][0], 'existing-alias');
      return;
    }
    reconciliation.errors.push({
      kind: candidates.size > 1 ? 'ambiguous-historical-reference' : 'unresolved-historical-reference',
      path: `${occurrence.document_path}.${occurrence.path}`,
      value: occurrence.value,
      product_name: occurrence.product_name || null,
      candidates: [...candidates]
    });
  });

  return reconciliation;
};

export const rewriteHistoricalReferences = (value, mapping, resolutions = new Map(), path = '') => {
  if (Array.isArray(value)) {
    return value.map((item, index) => rewriteHistoricalReferences(item, mapping, resolutions, `${path}[${index}]`));
  }
  if (!value || typeof value !== 'object') return value;
  if (!isPlainObject(value)) return value;

  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => {
    const childPath = path ? `${path}.${childKey}` : childKey;
    if (childKey === 'legacy_sku' || childKey === 'legacy_product_id') return [childKey, childValue];
    if (PRODUCT_REFERENCE_KEYS.has(childKey) && typeof childValue === 'string') {
      return [childKey, resolutions.get(childPath) || mapping.get(childValue) || childValue];
    }
    return [childKey, rewriteHistoricalReferences(childValue, mapping, resolutions, childPath)];
  }));
};

export const buildMappingFromPlan = (productDocuments, plannedEntries = [], archivedProducts = []) => {
  const mapping = new Map();
  const errors = [];
  const entriesByOldId = new Map(plannedEntries.map(entry => [entry.old_id, entry]));

  productDocuments.forEach(document => {
    const entry = entriesByOldId.get(document.id);
    if (!entry) {
      errors.push({ kind: 'plan-product-missing', product_id: document.id });
      return;
    }
    if ((entry.name || '') !== (document.data?.name || '')) {
      errors.push({ kind: 'plan-product-name-changed', product_id: document.id, planned_name: entry.name || '', actual_name: document.data?.name || '' });
      return;
    }
    const aliases = entry.aliases?.length ? entry.aliases : [document.id, document.data?.sku, document.data?.product_id];
    aliases.filter(nonEmpty).forEach(alias => mapping.set(alias, entry.new_id));
    mapping.set(entry.new_id, entry.new_id);
  });

  plannedEntries.forEach(entry => {
    if (!productDocuments.some(document => document.id === entry.old_id)) {
      errors.push({ kind: 'plan-product-not-found', product_id: entry.old_id });
    }
  });
  archivedProducts.forEach(product => mapping.set(product.id, product.id));

  return { mapping, entries: plannedEntries, errors };
};

export const reconciliationFromPlan = (planEnvironment = {}) => {
  const resolutionsByDocument = new Map();
  (planEnvironment.reconciliations || []).forEach(resolution => {
    if (!resolutionsByDocument.has(resolution.document_path)) resolutionsByDocument.set(resolution.document_path, new Map());
    resolutionsByDocument.get(resolution.document_path).set(resolution.path, resolution.new_id);
  });
  const archivedProducts = (planEnvironment.archived_products || []).map(product => ({
    id: product.id,
    data: product.data,
    legacy_id: product.legacy_id,
    name: product.name
  }));
  return {
    resolutions: planEnvironment.reconciliations || [],
    resolutionsByDocument,
    archivedProducts,
    errors: []
  };
};

export const rewriteProductReferences = (value, mapping, key = '') => {
  if (Array.isArray(value)) return value.map(item => rewriteProductReferences(item, mapping, key));
  if (!value || typeof value !== 'object') {
    if (PRODUCT_REFERENCE_KEYS.has(key) && typeof value === 'string') return mapping.get(value) || value;
    return value;
  }
  if (!isPlainObject(value)) return value;

  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
    childKey,
    childKey === 'legacy_sku' || childKey === 'legacy_product_id'
      ? childValue
      : rewriteProductReferences(childValue, mapping, childKey)
  ]));
};

export const findUnresolvedReferences = (value, mapping, path = '') => {
  const unresolved = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => unresolved.push(...findUnresolvedReferences(item, mapping, `${path}[${index}]`)));
    return unresolved;
  }
  if (!value || typeof value !== 'object') {
    if (PRODUCT_REFERENCE_KEYS.has(path.split('.').at(-1)?.split('[')[0]) && nonEmpty(value) && !mapping.has(value)) {
      unresolved.push({ path, value });
    }
    return unresolved;
  }

  Object.entries(value).forEach(([key, childValue]) => {
    const childPath = path ? `${path}.${key}` : key;
    if (PRODUCT_REFERENCE_KEYS.has(key) && nonEmpty(childValue) && !mapping.has(childValue)) {
      unresolved.push({ path: childPath, value: childValue });
      return;
    }
    if (key !== 'legacy_sku' && key !== 'legacy_product_id') {
      unresolved.push(...findUnresolvedReferences(childValue, mapping, childPath));
    }
  });
  return unresolved;
};

export const resolveInventoryProductId = (document, mapping) => {
  const byDocumentId = mapping.get(document.id);
  const storedProductId = document.data?.product_id;
  const byStoredId = nonEmpty(storedProductId) ? mapping.get(storedProductId) : null;

  if (byDocumentId && byStoredId && byDocumentId !== byStoredId) {
    return { error: { kind: 'ambiguous-inventory-reference', inventory_id: document.id, product_id: storedProductId } };
  }
  const productId = byDocumentId || byStoredId;
  return productId
    ? { productId }
    : { error: { kind: 'unresolved-inventory-reference', inventory_id: document.id, product_id: storedProductId || null } };
};
