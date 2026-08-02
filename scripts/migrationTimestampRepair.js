import { Timestamp } from 'firebase-admin/firestore';

const TIMESTAMP_KEYS = new Set(['_seconds', '_nanoseconds', 'seconds', 'nanoseconds']);

const isObject = value => value !== null && typeof value === 'object';

const isPlainObject = value => {
  if (!isObject(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const isTimestampMap = value => {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.every(key => TIMESTAMP_KEYS.has(key))) return false;

  const seconds = value._seconds ?? value.seconds;
  const nanoseconds = value._nanoseconds ?? value.nanoseconds;
  return Number.isInteger(seconds)
    && Number.isInteger(nanoseconds)
    && nanoseconds >= 0
    && nanoseconds < 1_000_000_000;
};

const timestampParts = value => ({
  seconds: value._seconds ?? value.seconds,
  nanoseconds: value._nanoseconds ?? value.nanoseconds
});

export const restoreTimestamps = (value, path = '', matches = []) => {
  if (value instanceof Timestamp) return value;
  if (isTimestampMap(value)) {
    const { seconds, nanoseconds } = timestampParts(value);
    matches.push({ path, seconds, nanoseconds });
    return new Timestamp(seconds, nanoseconds);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => restoreTimestamps(item, `${path}[${index}]`, matches));
  }
  if (!isPlainObject(value)) return value;

  return Object.fromEntries(Object.entries(value).map(([key, childValue]) => [
    key,
    restoreTimestamps(childValue, path ? `${path}.${key}` : key, matches)
  ]));
};

export const inspectTimestampMaps = documents => {
  const matches = [];
  const changedDocuments = [];
  documents.forEach(document => {
    const documentMatches = [];
    restoreTimestamps(document.data, '', documentMatches);
    if (documentMatches.length) {
      changedDocuments.push({
        id: document.id,
        timestamp_fields: documentMatches
      });
      matches.push(...documentMatches.map(match => ({ document_id: document.id, ...match })));
    }
  });
  return {
    changedDocuments,
    matches,
    documents: documents.length,
    documentsWithTimestampMaps: changedDocuments.length,
    timestampMaps: matches.length
  };
};
