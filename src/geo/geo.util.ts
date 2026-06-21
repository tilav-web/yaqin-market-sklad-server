const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

export interface BoundingBox {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

/**
 * A lat/lng square roughly `radiusKm` around a point, for cheap SQL pre-filtering
 * before the exact haversine pass. Avoids loading every shop in the database.
 */
export function boundingBox(lat: number, lng: number, radiusKm: number): BoundingBox {
  const latDelta = radiusKm / 111; // ~111 km per degree of latitude
  const lngDelta = radiusKm / (111 * Math.max(Math.cos(toRad(lat)), 0.01));
  return {
    latMin: lat - latDelta,
    latMax: lat + latDelta,
    lngMin: lng - lngDelta,
    lngMax: lng + lngDelta,
  };
}

export interface DeliveryFeeOptions {
  distanceKm: number;
  freeKm: number;
  pricingType: 'flat' | 'per_km' | 'per_500m' | 'per_100m';
  pricePerStep: number;
}

export function calcDeliveryFee(opts: DeliveryFeeOptions): number {
  if (opts.distanceKm <= opts.freeKm) return 0;
  const overKm = opts.distanceKm - opts.freeKm;
  switch (opts.pricingType) {
    case 'flat':
      return opts.pricePerStep;
    case 'per_km':
      return Math.ceil(overKm) * opts.pricePerStep;
    case 'per_500m':
      return Math.ceil(overKm * 2) * opts.pricePerStep;
    case 'per_100m':
      return Math.ceil(overKm * 10) * opts.pricePerStep;
    default:
      return opts.pricePerStep;
  }
}

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: [number, number][][]; // [[[lng, lat], ...]] — GeoJSON standard (lng first)
}

/** Ray-casting point-in-polygon check. polygon coords are [lng, lat] pairs (GeoJSON order). */
export function pointInPolygon(lat: number, lng: number, polygon: GeoJsonPolygon): boolean {
  const ring = polygon.coordinates[0];
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; // xi=lng, yi=lat
    const [xj, yj] = ring[j];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
