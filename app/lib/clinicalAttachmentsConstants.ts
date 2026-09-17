/** Client-side validation for clinical attachment uploads (must match storage bucket MIME list). */

export const CLINICAL_ATTACHMENTS_BUCKET = "clinical-attachments";

export const CLINICAL_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const CLINICAL_ATTACHMENT_ACCEPTED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
  "application/pdf",
]);

export const CLINICAL_ATTACHMENT_INPUT_ACCEPT = "image/*,application/pdf";

export function isAcceptedClinicalAttachmentMime(mime: string): boolean {
  const t = mime.trim().toLowerCase();
  if (t === "image/jpg") return true;
  return CLINICAL_ATTACHMENT_ACCEPTED_MIMES.has(t);
}

export function extensionForUpload(fileName: string, mime: string): string {
  const base = fileName.trim().toLowerCase();
  const dot = base.lastIndexOf(".");
  if (dot >= 0 && dot < base.length - 1) {
    const ext = base.slice(dot + 1, dot + 8);
    if (/^[a-z0-9]+$/i.test(ext)) return ext.slice(0, 5);
  }
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("heic")) return "heic";
  return "jpg";
}
