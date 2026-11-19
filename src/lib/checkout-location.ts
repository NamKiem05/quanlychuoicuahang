import provinceBoundaries from "./vietnam-checkout-boundaries.json";

export type Position = { latitude: number; longitude: number };
type WardBoundary = [code: number, box: number[], rings: number[][]];

function inBounds(box: number[], x: number, y: number) {
  return x >= box[0] && y >= box[1] && x <= box[2] && y <= box[3];
}

function insideRing(ring: number[], x: number, y: number) {
  let inside = false;
  for (let i = 0, previous = ring.length - 2; i < ring.length; previous = i, i += 2) {
    const yi = ring[i + 1];
    const yj = ring[previous + 1];
    if ((yi > y) !== (yj > y) &&
      x < ring[i] + (ring[previous] - ring[i]) * (y - yi) / (yj - yi)) {
      inside = !inside;
    }
  }
  return inside;
}

export async function lookupCheckoutLocation({ latitude, longitude }: Position, signal: AbortSignal) {
  const x = longitude * 1e5;
  const y = latitude * 1e5;
  const candidates = (provinceBoundaries as [number, number[]][])
    .filter(([, box]) => inBounds(box, x, y));

  // Fetch public polygons by province code. The coordinates stay in the browser.
  const matches = await Promise.all(candidates.map(async ([province]) => {
    const response = await fetch(`/checkout-boundaries/${province}.json`, { signal });
    if (!response.ok) throw new Error("Boundary data unavailable");
    const wards: WardBoundary[] = await response.json();
    return wards.filter(([, box, rings]) => inBounds(box, x, y) &&
      rings.some((ring) => insideRing(ring, x, y)))
      .map(([ward]) => ({ province, ward }));
  }));

  const locations = matches.flat();
  return locations.length === 1 ? locations[0] : null;
}
