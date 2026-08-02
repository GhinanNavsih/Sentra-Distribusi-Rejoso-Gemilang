import { randomInt } from 'node:crypto';

const PRODUCT_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const DIGIT_PATTERN = /\p{N}/u;
const LETTER_PATTERN = /\p{L}/u;

export const productIdPrefix = (name) => {
  const initials = String(name || '')
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .filter((word) => !DIGIT_PATTERN.test(word))
    .map((word) => word.match(LETTER_PATTERN)?.[0] || '')
    .join('')
    .toUpperCase();

  return initials || 'ITEM';
};

export const randomProductIdSuffix = (length = 4) => Array.from({ length }, () => (
  PRODUCT_ID_ALPHABET[randomInt(PRODUCT_ID_ALPHABET.length)]
)).join('');

export const createProductId = (name, suffixFactory = randomProductIdSuffix) => (
  `${productIdPrefix(name)}_${suffixFactory()}`
);

export const createUniqueProductId = async (
  name,
  isTaken,
  { suffixFactory = randomProductIdSuffix, maxAttempts = 10000 } = {}
) => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = createProductId(name, suffixFactory);
    if (!(await isTaken(candidate))) return candidate;
  }

  throw new Error('Tidak dapat menghasilkan ID produk unik. Silakan coba lagi.');
};

export const PRODUCT_ID_PATTERN = /^\p{L}+_[A-Z0-9]{4}$/u;
