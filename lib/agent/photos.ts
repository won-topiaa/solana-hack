// Photos the user uploads (watch dial, case back, box, papers). They may show a
// serial number, so they stay in the case file (off-chain) and are referred to
// by id everywhere else.

import { createHash } from "node:crypto";
import type { CaseFile } from "./types";

/** Image types the Gemini API accepts (https://ai.google.dev/gemini-api/docs/image-understanding). */
export const PHOTO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"] as const;

/** Keeps a request with several photos well under Gemini's 20 MB inline limit. */
export const MAX_PHOTO_BYTES = 7 * 1024 * 1024;

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
  const photoId = `photo-${Object.keys(caseFile.photos).length + 1}`;
  const stored = {
    mimeType: photo.mimeType,
    dataBase64: Buffer.from(photo.bytes).toString("base64"),
    sha256: createHash("sha256").update(photo.bytes).digest("hex"),
    addedAt: now.toISOString(),
  };
  return { caseFile: { ...caseFile, photos: { ...caseFile.photos, [photoId]: stored } }, photoId };
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
