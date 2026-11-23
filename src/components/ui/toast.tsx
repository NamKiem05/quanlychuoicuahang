"use client";

import { useEffect, useState } from "react";
import type { ToastVariant } from "@/lib/toast";

export default function Toast({ message, variant = "success" }: { message?: string; variant?: ToastVariant }) {
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;

    const timeoutId = window.setTimeout(() => setDismissedMessage(message), variant === "error" ? 7000 : 5000);
    return () => window.clearTimeout(timeoutId);
  }, [message, variant]);

  if (!message || dismissedMessage === message) return null;

  const icon = variant === "error" ? "!" : variant === "warning" ? "⚠" : "✓";
  return (
    <div className={`toast-notification toast-${variant}`} role={variant === "error" ? "alert" : "status"} aria-live={variant === "error" ? "assertive" : "polite"} aria-atomic="true">
      <span className="toast-icon" aria-hidden="true">{icon}</span>
      <p>{message}</p>
      <button type="button" className="toast-close" onClick={() => setDismissedMessage(message)} aria-label="Đóng thông báo">×</button>
    </div>
  );
}
