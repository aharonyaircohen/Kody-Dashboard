/**
 * @fileType browser-util
 * @domain preview-inspector
 * @pattern screenshot-optimizer
 *
 * Extension screenshots start as full-tab PNG data URLs. Before they enter
 * chat, crop and bound them so image models receive a normal screenshot and
 * text-only fallbacks do not inherit multi-megabyte base64 strings.
 */

export interface ScreenshotClip {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenshotSize {
  width: number;
  height: number;
  scaled: boolean;
}

export interface PreparedScreenshot {
  dataUrl: string;
  mimeType: string;
}

export const SCREENSHOT_OUTPUT_MIME_TYPE = "image/jpeg";
export const SCREENSHOT_OUTPUT_QUALITY = 0.78;
export const SCREENSHOT_MAX_EDGE = 1280;
export const SCREENSHOT_MAX_PIXELS = 1_000_000;
export const SCREENSHOT_MAX_DATA_URL_CHARS = 180_000;

export function getDataUrlMimeType(dataUrl: string): string {
  const match = /^data:([^;,]+)[;,]/.exec(dataUrl);
  return match?.[1] || "application/octet-stream";
}

export function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/png") return "png";
  return "bin";
}

export function constrainScreenshotSize(
  width: number,
  height: number,
  opts: {
    maxEdge?: number;
    maxPixels?: number;
  } = {},
): ScreenshotSize {
  const sourceWidth = Math.max(1, Math.round(width));
  const sourceHeight = Math.max(1, Math.round(height));
  const maxEdge = opts.maxEdge ?? SCREENSHOT_MAX_EDGE;
  const maxPixels = opts.maxPixels ?? SCREENSHOT_MAX_PIXELS;
  const edgeScale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const pixelScale = Math.min(
    1,
    Math.sqrt(maxPixels / (sourceWidth * sourceHeight)),
  );
  const scale = Math.min(edgeScale, pixelScale);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    scaled: scale < 1,
  };
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = dataUrl;
  });
}

function clampSourceRect(
  img: HTMLImageElement,
  clip?: ScreenshotClip,
): { sx: number; sy: number; sw: number; sh: number } {
  const imageWidth = Math.max(1, img.naturalWidth || img.width);
  const imageHeight = Math.max(1, img.naturalHeight || img.height);
  if (!clip) return { sx: 0, sy: 0, sw: imageWidth, sh: imageHeight };

  const dpr = window.devicePixelRatio || 1;
  const sx = Math.min(imageWidth - 1, Math.max(0, Math.round(clip.x * dpr)));
  const sy = Math.min(imageHeight - 1, Math.max(0, Math.round(clip.y * dpr)));
  const sw = Math.max(
    1,
    Math.min(imageWidth - sx, Math.round(clip.width * dpr)),
  );
  const sh = Math.max(
    1,
    Math.min(imageHeight - sy, Math.round(clip.height * dpr)),
  );
  return { sx, sy, sw, sh };
}

export async function prepareScreenshotDataUrl(
  dataUrl: string,
  clip?: ScreenshotClip,
): Promise<PreparedScreenshot> {
  const img = await loadImage(dataUrl);
  const source = clampSourceRect(img, clip);
  let size = constrainScreenshotSize(source.sw, source.sh);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { dataUrl, mimeType: getDataUrlMimeType(dataUrl) };
  }

  const encode = () => {
    canvas.width = size.width;
    canvas.height = size.height;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      img,
      source.sx,
      source.sy,
      source.sw,
      source.sh,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return canvas.toDataURL(
      SCREENSHOT_OUTPUT_MIME_TYPE,
      SCREENSHOT_OUTPUT_QUALITY,
    );
  };

  let optimized = encode();
  let attempts = 0;
  while (
    optimized.length > SCREENSHOT_MAX_DATA_URL_CHARS &&
    attempts < 4 &&
    Math.max(size.width, size.height) > 640
  ) {
    const shrink = Math.max(
      0.55,
      Math.sqrt(SCREENSHOT_MAX_DATA_URL_CHARS / optimized.length) * 0.9,
    );
    size = {
      width: Math.max(1, Math.round(size.width * shrink)),
      height: Math.max(1, Math.round(size.height * shrink)),
      scaled: true,
    };
    optimized = encode();
    attempts += 1;
  }

  return {
    dataUrl: optimized,
    mimeType: getDataUrlMimeType(optimized),
  };
}
