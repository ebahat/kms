/**
 * multer/busboy decode the `filename` param of a multipart/form-data `Content-Disposition` header
 * as latin1 by default (the multipart spec predates RFC 5987/2231 encoded-word support, and no
 * mainstream browser percent-encodes it) — a non-ASCII filename like a Hebrew document name arrives
 * as raw UTF-8 bytes, gets mis-decoded byte-for-byte as latin1, and comes out as mojibake. Re-decoding
 * those latin1 code units back into a UTF-8 byte buffer recovers the original string. This is a no-op
 * for ASCII filenames (ASCII round-trips identically through latin1 <-> utf8).
 */
export function decodeMultipartFilename(originalname: string): string {
  return Buffer.from(originalname, 'latin1').toString('utf8');
}
