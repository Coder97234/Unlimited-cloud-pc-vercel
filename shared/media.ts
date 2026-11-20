export const IMAGE_SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const;
export const MAX_VISION_QUESTION = 1_000;
export const MAX_VISION_BASE64 = 1_300_000;
export const MAX_VISION_SIDE = 1_536;
export const IMAGE_FILE_ACCEPT = '.jpg,.jpeg,.png,.webp';
export const isVisionFile = (file: { name: string; type: string }) => /^image\/(jpeg|png|webp)$/i.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);

// Check the container before decoding. Do not accept SVG or remote URLs.
export function rasterMime(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, i) => bytes[i] === value)) return 'image/png';
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
}

/** Read raster dimensions without decoding pixels, so opening a draft file is bounded too. */
export function rasterSize(bytes: Uint8Array) {
  const mime = rasterMime(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (mime === 'image/png' && bytes.length >= 24 && tag(12) === 'IHDR') return { width: view.getUint32(16), height: view.getUint32(20) };
  if (mime === 'image/webp') {
    switch (tag(12)) {
      case 'VP8X':
        if (bytes.length >= 30) return {
          width: 1 + view.getUint16(24, true) + (bytes[26] << 16),
          height: 1 + view.getUint16(27, true) + (bytes[29] << 16),
        };
        return;
      case 'VP8L':
        if (bytes.length >= 25 && bytes[20] === 0x2f) {
          const size = view.getUint32(21, true);
          return { width: (size & 0x3fff) + 1, height: ((size >>> 14) & 0x3fff) + 1 };
        }
        return;
      case 'VP8 ':
        if (bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) return {
          width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff,
        };
    }
  }
  if (mime !== 'image/jpeg') return;
  // JPEG stores the frame size after variable-length marker segments.
  for (let offset = 2; offset + 8 < bytes.length;) {
    if (bytes[offset++] !== 0xff) return;
    while (bytes[offset] === 0xff) offset++;
    if (offset + 2 >= bytes.length) return;
    const marker = bytes[offset++];
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length || marker === 0xda || marker === 0xd9) return;
    if ((marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 8) return;
      return { height: view.getUint16(offset + 3), width: view.getUint16(offset + 5) };
    }
    offset += length;
  }
}
