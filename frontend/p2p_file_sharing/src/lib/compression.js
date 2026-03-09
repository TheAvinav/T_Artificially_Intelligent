/**
 * Compression utilities using fflate.
 *
 * Files above COMPRESS_THRESHOLD are gzip-compressed before sending
 * over WebRTC. A 1-byte header flag tells the receiver whether to decompress.
 *
 * Header protocol:
 *   First message on the data channel is a JSON "meta" message:
 *     { meta: true, compressed: bool, originalSize: number, fileId: string }
 *   Then raw binary chunks follow (compressed or not).
 *   Final message is JSON: { done: true, fileId: string }
 */
import { gzipSync, gunzipSync, gzip as gzipAsync } from 'fflate';

// Files above 1 MB get compressed
export const COMPRESS_THRESHOLD = 1 * 1024 * 1024; // 1 MB

// File types that won't benefit from compression (already compressed)
const SKIP_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/ogg', 'audio/mp4',
  'application/zip', 'application/x-rar-compressed',
  'application/gzip', 'application/x-7z-compressed',
  'application/x-bzip2', 'application/x-tar',
  'application/pdf',
];

/**
 * Decide whether a file should be compressed.
 */
export function shouldCompress(file) {
  if (file.size < COMPRESS_THRESHOLD) return false;
  if (SKIP_TYPES.some(t => file.type.startsWith(t))) return false;
  return true;
}

/**
 * Compress a File object into a Uint8Array using gzip.
 * Uses async (Web Worker) version for large files to avoid blocking UI.
 * Falls back to sync for smaller files.
 */
export async function compressFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  // For files > 10MB, use async to avoid blocking
  if (file.size > 10 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      gzipAsync(data, { level: 6 }, (err, compressed) => {
        if (err) reject(err);
        else resolve(compressed);
      });
    });
  }

  // Sync for smaller files (faster, no worker overhead)
  return gzipSync(data, { level: 6 });
}

/**
 * Decompress a gzipped Uint8Array back to original data.
 */
export function decompressData(compressedData) {
  return gunzipSync(compressedData);
}

/**
 * Get compression ratio as a readable string.
 */
export function compressionRatio(originalSize, compressedSize) {
  const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
  return `${ratio}% smaller`;
}