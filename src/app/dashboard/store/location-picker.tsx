"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Image from "next/image";
import { updateStoreLocation } from "../actions";

const TILE_SIZE = 256;
const DEFAULT_CENTER = { latitude: 10.7769, longitude: 106.7009 };
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}.png";

type Position = { latitude: number; longitude: number };
type Tile = { key: string; url: string; left: number; top: number };
type DragState = { pointerId: number; startX: number; startY: number; center: Position; moved: boolean };

function project(position: Position, zoom: number) {
  const worldSize = TILE_SIZE * 2 ** zoom;
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, position.latitude));
  const sin = Math.sin(latitude * Math.PI / 180);
  return {
    x: (position.longitude + 180) / 360 * worldSize,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * worldSize,
  };
}

function unproject(x: number, y: number, zoom: number): Position {
  const worldSize = TILE_SIZE * 2 ** zoom;
  const longitude = x / worldSize * 360 - 180;
  const mercator = Math.PI * (1 - 2 * y / worldSize);
  const latitude = Math.atan(Math.sinh(mercator)) * 180 / Math.PI;
  return {
    latitude: Math.max(-85.05112878, Math.min(85.05112878, latitude)),
    longitude: Math.max(-180, Math.min(180, longitude)),
  };
}

function getVisibleTiles(center: Position, zoom: number, width: number, height: number): Tile[] {
  const centerPixel = project(center, zoom);
  const leftEdge = centerPixel.x - width / 2;
  const topEdge = centerPixel.y - height / 2;
  const startX = Math.floor(leftEdge / TILE_SIZE);
  const endX = Math.floor((leftEdge + width) / TILE_SIZE);
  const startY = Math.floor(topEdge / TILE_SIZE);
  const endY = Math.floor((topEdge + height) / TILE_SIZE);
  const tileCount = 2 ** zoom;
  const tiles: Tile[] = [];

  for (let tileY = startY; tileY <= endY; tileY += 1) {
    if (tileY < 0 || tileY >= tileCount) continue;
    for (let tileX = startX; tileX <= endX; tileX += 1) {
      const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
      tiles.push({
        key: `${zoom}:${tileX}:${tileY}`,
        url: TILE_URL.replace("{z}", String(zoom)).replace("{x}", String(wrappedX)).replace("{y}", String(tileY)),
        left: tileX * TILE_SIZE - leftEdge,
        top: tileY * TILE_SIZE - topEdge,
      });
    }
  }

  return tiles;
}

export default function StoreLocationPicker({
  initialLatitude,
  initialLongitude,
}: {
  initialLatitude: number | null;
  initialLongitude: number | null;
}) {
  const initialPosition: Position | null = initialLatitude == null || initialLongitude == null
    ? null
    : { latitude: initialLatitude, longitude: initialLongitude };
  const [position, setPosition] = useState<Position | null>(initialPosition);
  const [center, setCenter] = useState<Position>(initialPosition ?? DEFAULT_CENTER);
  const [zoom, setZoom] = useState(initialPosition ? 16 : 13);
  const [viewport, setViewport] = useState({ width: 760, height: 350 });
  const [message, setMessage] = useState("");
  const [tilesFailed, setTilesFailed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    const element = mapRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setViewport({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const tiles = useMemo(() => getVisibleTiles(center, zoom, viewport.width, viewport.height), [center, zoom, viewport]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button, a")) return;
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      center,
      moved: false,
    };
    setIsDragging(false);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) > 4) {
      drag.moved = true;
      setIsDragging(true);
    }
    if (!drag.moved) return;
    const originalCenter = project(drag.center, zoom);
    const nextCenter = unproject(originalCenter.x - deltaX, originalCenter.y - deltaY, zoom);
    setCenter(nextCenter);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    const originalCenter = project(drag.center, zoom);
    const finalCenter = drag.moved
      ? unproject(originalCenter.x - deltaX, originalCenter.y - deltaY, zoom)
      : drag.center;
    setCenter(finalCenter);

    if (!drag.moved && mapRef.current) {
      const rect = mapRef.current.getBoundingClientRect();
      setPosition(unproject(
        project(finalCenter, zoom).x + event.clientX - rect.left - rect.width / 2,
        project(finalCenter, zoom).y + event.clientY - rect.top - rect.height / 2,
        zoom,
      ));
      setMessage("Đã chọn vị trí. Bấm lưu để cập nhật.");
    }
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setMessage("Trình duyệt này không hỗ trợ xác định vị trí. Bạn có thể kéo bản đồ đến cửa hàng.");
      return;
    }
    setMessage("Đang xác định vị trí…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const next = { latitude: coords.latitude, longitude: coords.longitude };
        setPosition(next);
        setCenter(next);
        setZoom(16);
        setMessage("Đã lấy vị trí hiện tại. Nếu cần, hãy kéo bản đồ để chỉnh ghim rồi lưu.");
      },
      () => setMessage("Không lấy được vị trí. Hãy cho phép trình duyệt truy cập vị trí hoặc chọn trực tiếp trên bản đồ."),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  };

  const changeZoom = (amount: number) => {
    setZoom((currentZoom) => Math.max(4, Math.min(18, currentZoom + amount)));
  };

  const marker = position ? project(position, zoom) : null;
  const centerPixel = project(center, zoom);

  return (
    <form className="store-location-picker" action={updateStoreLocation}>
      <p className="dashboard-help">Bấm vào bản đồ để đặt ghim, kéo bản đồ để di chuyển. Bạn cũng có thể dùng vị trí hiện tại nếu đang ở cửa hàng.</p>
      <div
        className="store-location-map"
        ref={mapRef}
        role="application"
        aria-label="Bản đồ chọn vị trí cửa hàng"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { dragRef.current = null; setIsDragging(false); }}
        style={{ cursor: isDragging ? "grabbing" : "crosshair" }}
      >
        {tiles.map((tile) => <Image
          className="store-location-tile"
          key={tile.key}
          src={tile.url}
          alt=""
          width={TILE_SIZE}
          height={TILE_SIZE}
          unoptimized
          draggable={false}
          style={{ left: tile.left, top: tile.top }}
          onError={() => setTilesFailed(true)}
        />)}
        {marker && <span
          className="store-location-marker"
          aria-hidden="true"
          style={{
            left: marker.x - (centerPixel.x - viewport.width / 2),
            top: marker.y - (centerPixel.y - viewport.height / 2),
          }}
        ><span /></span>}
        <div className="store-location-zoom" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" aria-label="Phóng to bản đồ" onClick={() => changeZoom(1)}>+</button>
          <button type="button" aria-label="Thu nhỏ bản đồ" onClick={() => changeZoom(-1)}>−</button>
        </div>
        <button className="store-location-current" type="button" onPointerDown={(event) => event.stopPropagation()} onClick={useCurrentLocation}>
          ◎ Vị trí hiện tại
        </button>
        <div className="store-location-attribution">
          <a href="https://stadiamaps.com/attribution/" target="_blank" rel="noreferrer">© Stadia Maps</a>
          <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a>
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
        </div>
      </div>
      {tilesFailed && <p className="store-location-map-error" role="alert">Không tải được nền bản đồ. Hãy kiểm tra kết nối hoặc cấu hình nhà cung cấp bản đồ.</p>}
      <div className="store-location-selected">
        <span className={position ? "is-selected" : ""}><i />{position ? "Đã chọn vị trí cửa hàng" : "Chưa chọn vị trí cửa hàng"}</span>
        {position && <code>{position.latitude.toFixed(6)}, {position.longitude.toFixed(6)}</code>}
      </div>
      {message && <p className="store-location-message" role="status">{message}</p>}
      <input type="hidden" name="latitude" value={position?.latitude ?? ""} />
      <input type="hidden" name="longitude" value={position?.longitude ?? ""} />
      <button className="secondary-submit" type="submit" disabled={!position}>Lưu vị trí cửa hàng</button>
    </form>
  );
}
