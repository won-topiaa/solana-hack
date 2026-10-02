// Prepares a watch photo in the browser before upload: scaled down to at most 1600
// pixels on the long side and saved as JPEG. That keeps a request well under the
// hosting limit (4.5 MB on Vercel) and is still sharp enough to read a dial or papers.

export type PhotoForUpload = { mimeType: string; dataBase64: string; name: string; previewUrl: string };

const MAX_SIDE = 1600;
const QUALITY = 0.85;
/** Sent unchanged when the browser cannot decode it (HEIC in most browsers); the server accepts up to 2.5 MB. */
const MAX_UNCHANGED_BYTES = 2.5 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];

function toBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function preparePhoto(file: File): Promise<PhotoForUpload> {
  if (!ACCEPTED.includes(file.type)) throw new Error("Use a PNG, JPEG, WEBP or HEIC photo");
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("Could not prepare the photo"))), "image/jpeg", QUALITY),
    );
    return { mimeType: "image/jpeg", dataBase64: toBase64(await blob.arrayBuffer()), name: file.name, previewUrl: URL.createObjectURL(blob) };
  } catch {
    // The browser cannot decode it (for example HEIC): send it as it is if it is small enough.
    if (file.size > MAX_UNCHANGED_BYTES) throw new Error("This photo is too large to send as it is; use a JPEG or PNG");
    return { mimeType: file.type, dataBase64: toBase64(await file.arrayBuffer()), name: file.name, previewUrl: "" };
  }
}
