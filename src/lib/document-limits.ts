export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

// AES-GCM appends a 16-byte authentication tag to every document's ciphertext.
export const MAX_ENCRYPTED_DOCUMENT_BYTES = MAX_DOCUMENT_BYTES + 16;
