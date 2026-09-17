/**
 * Converts raster types that OCR / Document AI often reject into JPEG in the browser.
 */
function extLower(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

function needsJpegConversion(file: File): boolean {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return false;
  }
  const t = file.type.toLowerCase();
  const ext = extLower(file.name);
  return (
    t === "image/webp" ||
    t === "image/heic" ||
    t === "image/heif" ||
    ext === "webp" ||
    ext === "heic" ||
    ext === "heif"
  );
}

/**
 * Returns a new File (JPEG) when the input is webp/heic/heif (by MIME or extension); otherwise the original file.
 */
export async function ensureJpegForOcrUpload(file: File): Promise<File> {
  if (!needsJpegConversion(file)) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      "Could not read this image format in the browser. Try converting to JPEG or PNG, or use a different browser.",
    );
  }

  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare image for OCR.");
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.95));
    if (!blob) throw new Error("JPEG conversion failed.");
    const base = file.name.replace(/\.[^.\\/]+$/i, "").trim() || "scan";
    const out = new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: Date.now() });

    return out;
  } finally {
    bitmap.close();
  }
}
