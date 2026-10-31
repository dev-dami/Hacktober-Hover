import sharp from "sharp";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = { jpeg: "jpg", png: "png", webp: "webp", heif: "heic" };

export class ImageError extends Error {}

export interface PreparedImage {
  /** Original bytes and extension, kept for training data. */
  original: Uint8Array;
  originalExtension: string;
  /** Upright JPEG, at most 2000px on the long side, metadata (incl. GPS) stripped. */
  jpeg: Uint8Array;
  width: number;
  height: number;
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) throw new ImageError("Choose an image of up to 10 MB.");
  const original = new Uint8Array(await file.arrayBuffer());
  const image = sharp(original, { limitInputPixels: 40_000_000, failOn: "error" });
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await image.metadata();
  } catch {
    throw new ImageError("That file is not a readable image.");
  }
  const extension = metadata.format ? EXTENSIONS[metadata.format] : undefined;
  if (!extension) throw new ImageError("Use a JPEG, PNG, WebP or HEIC photo.");

  // rotate() applies the EXIF orientation; sharp drops all metadata from the output by default.
  const { data, info } = await image
    .rotate()
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer({ resolveWithObject: true });
  return { original, originalExtension: extension, jpeg: new Uint8Array(data), width: info.width, height: info.height };
}

/** Copy of the original with metadata removed, for storing user uploads. */
export async function stripMetadata(original: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await sharp(original).rotate().toBuffer());
}
