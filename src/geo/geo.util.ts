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
