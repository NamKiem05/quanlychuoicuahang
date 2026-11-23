"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export default function OrderDetailsModal({
  orderCode,
  subtitle,
  variant = "merchant",
  openOnLoad = false,
  triggerLabel = "Xem",
  children,
}: {
  orderCode: string;
  subtitle: string;
  variant?: "admin" | "merchant";
  openOnLoad?: boolean;
  triggerLabel?: string;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!openOnLoad) return;
    const frame = window.requestAnimationFrame(() => setIsOpen(true));
    return () => window.cancelAnimationFrame(frame);
  }, [openOnLoad]);

  useEffect(() => {
    if (!isOpen) return;

    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
        "button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])",
      );
      const enabled = Array.from(focusable ?? []).filter((element) => !element.hasAttribute("disabled"));
      if (!enabled.length) return;
      const first = enabled[0];
      const last = enabled[enabled.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => trigger?.focus());
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={triggerRef}
        className="order-details-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(true)}
      >
        {triggerLabel}
      </button>
      {isOpen ? createPortal(
        <div
          className={`order-details-modal-backdrop is-${variant}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsOpen(false);
          }}
        >
          <section
            ref={modalRef}
            className="order-details-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
          >
            <header className="order-details-modal-header">
              <div>
                <span className="dashboard-kicker">CHI TIẾT ĐƠN HÀNG</span>
                <h2 id={titleId}>{orderCode}</h2>
                <p>{subtitle}</p>
              </div>
              <button
                ref={closeButtonRef}
                className="dialog-close"
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Đóng chi tiết đơn hàng"
              >
                ×
              </button>
            </header>
            <div className="order-details-modal-content">{children}</div>
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
