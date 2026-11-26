"use client";

import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

const themeKey = "growdesk-landing-theme";
const themeEvent = "growdesk-landing-theme-change";
const ThemeContext = createContext(false);
let temporaryTheme: boolean | undefined;

function readTheme() {
  if (temporaryTheme !== undefined) return temporaryTheme;
  try {
    return localStorage.getItem(themeKey) === "dark";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(themeEvent, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(themeEvent, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function LandingTheme({ children }: { children: ReactNode }) {
  const dark = useSyncExternalStore(subscribe, readTheme, () => false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !("IntersectionObserver" in window)) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sections = Array.from(root.querySelectorAll<HTMLElement>("[data-landing-reveal]"));
    const stats = Array.from(root.querySelectorAll<HTMLElement>("[data-landing-stat]"));
    const cleanups: (() => void)[] = [];

    function configureMotion() {
      cleanups.splice(0).forEach((cleanup) => cleanup());
      if (motion.matches) return;

      const reveal = new IntersectionObserver((entries) => {
        entries.forEach(({ target, isIntersecting }) => {
          target.setAttribute("data-landing-reveal", isIntersecting ? "visible" : "hidden");
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
      sections.forEach((section) => reveal.observe(section));
      cleanups.push(() => {
        reveal.disconnect();
        sections.forEach((section) => section.setAttribute("data-landing-reveal", ""));
      });

      const counters = new Map(stats.map((element) => [element, {
        frame: 0,
        original: element.textContent,
        value: Number(element.dataset.landingStat),
        suffix: element.dataset.suffix,
        format: new Intl.NumberFormat("vi-VN", {
          minimumFractionDigits: Number(element.dataset.decimals),
          maximumFractionDigits: Number(element.dataset.decimals),
        }),
      }]));

      const count = new IntersectionObserver((entries) => {
        entries.forEach(({ target, intersectionRatio }) => {
          const counter = counters.get(target as HTMLElement);
          if (!counter) return;
          cancelAnimationFrame(counter.frame);
          target.textContent = counter.format.format(0) + counter.suffix;
          if (intersectionRatio < 0.6) return;

          const start = performance.now();
          const tick = (now: number) => {
            const progress = Math.min((now - start) / 2200, 1);
            const eased = 1 - (1 - progress) ** 3;
            target.textContent = counter.format.format(counter.value * eased) + counter.suffix;
            if (progress < 1) counter.frame = requestAnimationFrame(tick);
          };
          counter.frame = requestAnimationFrame(tick);
        });
      }, { threshold: 0.6 });
      stats.forEach((stat) => count.observe(stat));
      cleanups.push(() => {
        count.disconnect();
        counters.forEach(({ frame, original }, element) => {
          cancelAnimationFrame(frame);
          element.textContent = original;
        });
      });
    }

    configureMotion();
    motion.addEventListener("change", configureMotion);
    return () => {
      motion.removeEventListener("change", configureMotion);
      cleanups.splice(0).forEach((cleanup) => cleanup());
    };
  }, []);

  return (
    <ThemeContext.Provider value={dark}>
      <div ref={rootRef} id="platform-home" data-theme={dark ? "dark" : "light"}>{children}</div>
    </ThemeContext.Provider>
  );
}

export function LandingThemeButton() {
  const dark = useContext(ThemeContext);
  return (
    <button
      type="button"
      className="landing-theme-button"
      aria-label="Giao diện tối"
      aria-pressed={dark}
      onClick={() => {
        try {
          localStorage.setItem(themeKey, dark ? "light" : "dark");
          temporaryTheme = undefined;
        } catch {
          temporaryTheme = !dark;
        }
        window.dispatchEvent(new Event(themeEvent));
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        {dark
          ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>
          : <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />}
      </svg>
    </button>
  );
}

export function LandingPreviewTilt({ children }: { children: ReactNode }) {
  return (
    <div
      className="landing-preview-stage"
      aria-hidden="true"
      onPointerMove={({ currentTarget, pointerType, clientX, clientY }) => {
        if (pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const bounds = currentTarget.getBoundingClientRect();
        currentTarget.style.setProperty("--landing-ry", `${-16 + ((clientX - bounds.left) / bounds.width - 0.5) * 22}deg`);
        currentTarget.style.setProperty("--landing-rx", `${7 - ((clientY - bounds.top) / bounds.height - 0.5) * 16}deg`);
      }}
      onPointerLeave={({ currentTarget }) => {
        currentTarget.style.removeProperty("--landing-ry");
        currentTarget.style.removeProperty("--landing-rx");
      }}
    >
      <div className="landing-preview-float"><div className="landing-preview-tilt">{children}</div></div>
    </div>
  );
}
