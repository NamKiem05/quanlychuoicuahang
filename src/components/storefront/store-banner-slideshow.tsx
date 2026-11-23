"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import "./store-banner-slideshow.css";

const motionQuery = "(prefers-reduced-motion: reduce)";

function subscribeMotionPreference(onChange: () => void) {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export default function StoreBannerSlideshow({ urls, storeName, href, onOpenMenu, linkLabel }: {
  urls: string[];
  storeName: string;
  href?: string;
  onOpenMenu?: () => void;
  linkLabel?: string;
}) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const touchStart = useRef<number | null>(null);
  const reducedMotion = useSyncExternalStore(subscribeMotionPreference, () => window.matchMedia(motionQuery).matches, () => false);
  const multiple = urls.length > 1;
  const rotating = multiple && !paused && !reducedMotion;

  useEffect(() => {
    if (!rotating || hovered) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setActive((index) => (index + 1) % urls.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [rotating, hovered, urls.length, active]);

  function moveSlide(change: number) {
    setPaused(true);
    setActive((index) => (index + change + urls.length) % urls.length);
  }

  return (
    <div
      className="store-banner-slideshow"
      role="region"
      aria-roledescription="trình chiếu"
      aria-label={`Banner ${storeName}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setPaused(true)}
    >
      <div
        className="store-banner-frame"
        onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }}
        onTouchEnd={(event) => {
          const end = event.changedTouches[0]?.clientX;
          if (multiple && touchStart.current !== null && end !== undefined && Math.abs(end - touchStart.current) > 50) {
            moveSlide(end < touchStart.current ? 1 : -1);
          }
          touchStart.current = null;
        }}
      >
        <div className="store-banner-track" style={{ transform: `translateX(-${active * 100}%)` }} aria-live="off">
          {urls.map((url, index) => {
            const Picture = href ? "a" : "div";
            return (
              <div className="store-banner-slide" key={url} aria-hidden={index !== active} inert={index !== active}>
                <Picture className="store-banner-picture" href={href} onClick={onOpenMenu} aria-label={href ? (linkLabel ?? `Xem thực đơn của ${storeName}`) : undefined}>
                  <Image className="store-banner-backdrop" src={url} alt="" fill unoptimized />
                  <Image className="store-banner-image" src={url} alt={`Banner ${index + 1} của ${storeName}`} fill sizes="(max-width: 1400px) 100vw, 1340px" loading={index === 0 ? "eager" : "lazy"} unoptimized />
                </Picture>
              </div>
            );
          })}
        </div>
        {multiple && (
          <>
            <button className="store-banner-arrow is-previous" type="button" aria-label="Banner trước" onClick={() => moveSlide(-1)}>‹</button>
            <button className="store-banner-arrow is-next" type="button" aria-label="Banner tiếp theo" onClick={() => moveSlide(1)}>›</button>
          </>
        )}
      </div>
      {multiple && (
        <div className="store-banner-controls">
          {urls.map((url, index) => (
            <button key={url} type="button" className="store-banner-dot" aria-label={`Xem banner ${index + 1}`} aria-pressed={active === index} onClick={() => { setPaused(true); setActive(index); }}><span /></button>
          ))}
          {!reducedMotion && <button type="button" className="store-banner-play" onClick={() => setPaused((value) => !value)} aria-label={rotating ? "Dừng tự chuyển banner" : "Bật tự chuyển banner"}>{rotating ? "Ⅱ" : "▷"}</button>}
        </div>
      )}
    </div>
  );
}
