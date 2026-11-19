/**
 * Check a chosen picture; big photos are shrunk to 1600 px (WebP) on this
 * device so the site stays fast. GIF and SVG are kept as they are.
 */
export async function prepareImage(file: File): Promise<{ blob: Blob; ext: string } | { error: string }> {
  const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" };
  if (!EXT[file.type]) return { error: "Use a PNG, JPG, WebP, GIF or SVG image." };
  if (file.size <= 600 * 1024 || file.type === "image/gif" || file.type === "image/svg+xml") {
    return file.size > 3 * 1024 * 1024 ? { error: "That image is over 3 MB. Use a smaller one." } : { blob: file, ext: EXT[file.type] };
  }
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/webp", 0.85));
    if (!blob) return { error: "This browser couldn't read that picture." };
    return { blob, ext: "webp" };
  } catch {
    return { error: "This browser couldn't read that picture." };
  }
}
