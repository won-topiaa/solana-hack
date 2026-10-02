// Photos the user uploads (watch dial, case back, box, papers). They may show a
// serial number, so they stay in the case file (off-chain) and are referred to
// by id everywhere else.

import { createHash } from "node:crypto";
import type { CaseFile } from "./types";

/** Image types the Gemini API accepts (https://ai.google.dev/gemini-api/docs/image-understanding). */
export const PHOTO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"] as const;

/** Keeps a request with several photos well under Gemini's 20 MB inline limit. */
export const MAX_PHOTO_BYTES = 7 * 1024 * 1024;

/**
 * The file's first bytes must match its declared type, so a request cannot pass other
 * data off as a photo. Signatures: JPEG FF D8 FF; PNG 89 50 4E 47 0D 0A 1A 0A;
 * WEBP "RIFF" then "WEBP" at byte 8; HEIC/HEIF an ISO box "ftyp" at byte 4.
 */
export function looksLikeImage(mimeType: string, bytes: Uint8Array): boolean {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  switch (mimeType) {
    case "image/jpeg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
    case "image/webp":
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    case "image/heic":
    case "image/heif":
      return ascii(4, 8) === "ftyp";
    default:
      return false;
  }
}

export function addPhoto(
  caseFile: CaseFile,
  photo: { mimeType: string; bytes: Uint8Array },
  now: Date = new Date(),
): { caseFile: CaseFile; photoId: string } {
  if (!(PHOTO_MIME_TYPES as readonly string[]).includes(photo.mimeType)) {
    throw new Error(`Unsupported photo type ${photo.mimeType}; use PNG, JPEG, WEBP, HEIC or HEIF`);
  }
  if (photo.bytes.length === 0 || photo.bytes.length > MAX_PHOTO_BYTES) {
    throw new Error(`A photo must be between 1 byte and ${MAX_PHOTO_BYTES / (1024 * 1024)} MB`);
  }
  if (!looksLikeImage(photo.mimeType, photo.bytes)) throw new Error(`The file is not a ${photo.mimeType} image`);
  const photoId = `photo-${Object.keys(caseFile.photos).length + 1}`;
  const stored = {
    mimeType: photo.mimeType,
    dataBase64: Buffer.from(photo.bytes).toString("base64"),
    sha256: createHash("sha256").update(photo.bytes).digest("hex"),
    addedAt: now.toISOString(),
  };
  return { caseFile: { ...caseFile, photos: { ...caseFile.photos, [photoId]: stored } }, photoId };
}

/**
 * Drops the image bytes of photos that a watch was already read from. The web app
 * carries the case in every request, so read photos would only make it heavy; the
 * sha256 stays (the asset passport uses it as evidence).
 */
export function dropReadPhotoBytes(caseFile: CaseFile): CaseFile {
  const read = new Set(caseFile.assets.flatMap((asset) => (asset.kind === "watch" ? asset.photoIds : [])));
  const photos = Object.fromEntries(
    Object.entries(caseFile.photos).map(([id, photo]) => {
      const kept = read.has(id) ? { mimeType: photo.mimeType, sha256: photo.sha256, addedAt: photo.addedAt } : photo;
      return [id, kept];
    }),
  );
  return { ...caseFile, photos };
}

/** Picks the photo type from a file name, for the terminal chat's /photo command. */
export function mimeTypeFromFileName(fileName: string): string {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  const byExtension: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
  };
  return byExtension[extension] ?? `unknown (.${extension})`;
}
