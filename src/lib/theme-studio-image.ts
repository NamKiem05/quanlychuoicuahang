export const maxThemeImageBytes = 2 * 1024 * 1024;

export function themeStudioImageType(bytes: Uint8Array) {
  if (bytes.length > maxThemeImageBytes) return null;
  if (bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
    && String.fromCharCode(...bytes.slice(12, 16)) === "IHDR") return { extension: "png", mime: "image/png" };
  if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    && bytes.at(-2) === 255 && bytes.at(-1) === 217) return { extension: "jpg", mime: "image/jpeg" };
  if (bytes.length >= 20 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    && ["VP8 ", "VP8L", "VP8X"].includes(String.fromCharCode(...bytes.slice(12, 16)))) return { extension: "webp", mime: "image/webp" };
  return null;
}
