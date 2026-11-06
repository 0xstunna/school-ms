/**
 * IMAGE UTILS — client-side logo upload pipeline
 * ==============================================
 *
 * Validates and compresses a school logo on the browser before it is stored
 * as a base64 data URL in the Firestore `config/app_config` settings doc.
 *
 * No Firebase Storage is used: the compressed image becomes a small text
 * string that embeds cleanly in PDF print output and survives printing.
 *
 * Limits:
 *   - Accepted types: PNG, JPG, WebP
 *   - Max upload size: 500 KB (client-side; user is told before any read)
 *   - Output max dimension: 300 px (downscale only — never upscale)
 *   - JPEG output quality: 0.85 (good quality, small file)
 */

// Accepted MIME types for upload.
const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

// Max upload size in bytes (~500 KB).
const MAX_UPLOAD_BYTES = 500 * 1024;

// Max output dimension in px. The canvas is scaled down to fit within this box,
// preserving aspect ratio. Images smaller than this are left untouched.
const MAX_DIMENSION = 300;

/**
 * Validate a file before the user picks / reads it.
 *
 * @param {File} file
 * @returns {{ ok: true, file } | { ok: false, error: string }}
 */
export const validateImageFile = (file) => {
  if (!file) return { ok: false, error: 'No file selected.' };
  if (!ACCEPTED_TYPES.has(file.type)) {
    return {
      ok: false,
      error: `Unsupported file type "${file.type}". Please upload a PNG, JPG or WebP image.`,
    };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const maxMB = (MAX_UPLOAD_BYTES / (1024 * 1024)).toFixed(2);
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    return {
      ok: false,
      error: `File too large: ${sizeMB} MB. Maximum is ${maxMB} MB.`,
    };
  }
  return { ok: true, file };
};

/**
 * Read a File as a data URL (base64). Used as the input image source.
 *
 * @param {File} file
 * @returns {Promise<string>} data URL
 */
export const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });

/**
 * Load a data URL / image URL into an <img> and wait for it to decode.
 *
 * @param {string} src
 * @returns {Promise<HTMLImageElement>}
 */
const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image.'));
    img.src = src;
  });

/**
 * Compress an image to a base64 data URL.
 *
 * - Downscales only (never upscales) so small logos stay crisp.
 * - PNG stays PNG (preserves transparency).
 * - JPG / WebP become JPEG at quality 0.85.
 *
 * @param {File | string} input  a File or a data URL string
 * @param {number} [maxDimension=300] max width or height in px
 * @returns {Promise<string>} base64 data URL
 */
export const compressImage = async (input, maxDimension = MAX_DIMENSION) => {
  const src = typeof input === 'string' ? input : await readAsDataUrl(input);
  const img = await loadImage(src);

  const { width: naturalWidth, height: naturalHeight } = img;
  const scale = Math.min(1, maxDimension / naturalWidth, maxDimension / naturalHeight);

  const drawWidth = Math.round(naturalWidth * scale);
  const drawHeight = Math.round(naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = drawWidth;
  canvas.height = drawHeight;

  const ctx = canvas.getContext('2d');
  // Smooth downscale; crisp edges for tiny logos.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, drawWidth, drawHeight);

  // Preserve transparency for PNGs; everything else becomes JPEG.
  const isPng = typeof input === 'string'
    ? src.startsWith('data:image/png')
    : input.type === 'image/png';

  if (isPng) {
    return canvas.toDataURL('image/png');
  }
  return canvas.toDataURL('image/jpeg', 0.85);
};

export { ACCEPTED_TYPES, MAX_UPLOAD_BYTES, MAX_DIMENSION };
