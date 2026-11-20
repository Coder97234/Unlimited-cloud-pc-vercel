import { MAX_VISION_BASE64, MAX_VISION_SIDE, rasterMime, rasterSize } from '../../shared/media.ts';

export type VisionPhoto = { name: string; blob: Blob; width: number; height: number };
export async function prepareVisionPhoto(file: File, signal: AbortSignal): Promise<VisionPhoto> {
  if (file.size < 12 || file.size > 8_000_000) throw new Error('Choose an image under 8 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = rasterMime(bytes);
  if (!mime) throw new Error('Choose a JPEG, PNG, or WebP image.');
  const dimensions = rasterSize(bytes);
  if (!dimensions || !dimensions.width || !dimensions.height) throw new Error('The image dimensions could not be read.');
  if (dimensions.width * dimensions.height > 32_000_000 || Math.max(dimensions.width, dimensions.height) > 16_384) {
    throw new Error('This image has too many pixels. Resize it before opening.');
  }
  signal.throwIfAborted();
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file.slice(0, file.size, mime)); }
  catch { throw new Error('The image could not be opened in this browser.'); }
  try {
    if (bitmap.width * bitmap.height > 32_000_000) throw new Error('This image has too many pixels. Resize it before opening.');
    signal.throwIfAborted();
    const ratio = Math.min(1, MAX_VISION_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    const width = canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    const height = canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image preparation is unavailable in this browser.');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    // Re-encoding starts with only the pixels, not the original EXIF metadata.
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .84));
    signal.throwIfAborted();
    if (!blob || Math.ceil(blob.size / 3) * 4 > MAX_VISION_BASE64) throw new Error('This image is too detailed. Crop or resize it and try again.');
    return { name: file.name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 100) || 'image', blob, width, height };
  } finally { bitmap.close(); }
}

export async function photoBase64(blob: Blob, signal: AbortSignal) {
  const data = new Uint8Array(await blob.arrayBuffer());
  signal.throwIfAborted();
  let text = '';
  for (let start = 0; start < data.length; start += 8_192) text += String.fromCharCode(...data.subarray(start, start + 8_192));
  return btoa(text);
}
