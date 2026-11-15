export type ToastVariant = "success" | "error" | "warning";

export function toastVariantForMessage(key: string): ToastVariant {
  if (key.endsWith("-email-failed") || key.endsWith("-image-cleanup-failed")) return "warning";
  if (key === "domain-dns-pending" || key === "domain-target-not-configured") return "warning";
  if (/(invalid|failed|required|taken|not-admin|protected|not-found|already-admin)/i.test(key)) return "error";
  if (key === "domain-service-key-missing" || key === "domain-not-found") return "error";
  return "success";
}
