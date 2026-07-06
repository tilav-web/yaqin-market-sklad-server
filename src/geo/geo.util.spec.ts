import { calcDeliveryFee, haversineKm, pointInPolygon } from './geo.util';

describe('haversineKm', () => {
  it('bir xil nuqta uchun 0 qaytaradi', () => {
    expect(haversineKm(41.3, 69.3, 41.3, 69.3)).toBeCloseTo(0, 5);
  });

  it('Toshkent — Samarqand masofasi taxminan 267 km (to\'g\'ri chiziq)', () => {
    const km = haversineKm(41.2995, 69.2401, 39.6270, 66.9750);
    expect(km).toBeGreaterThan(250);
    expect(km).toBeLessThan(285);
  });
});

describe('calcDeliveryFee', () => {
  it('freeKm ichida bo\'lsa 0 to\'lov', () => {
    expect(calcDeliveryFee({ distanceKm: 1.5, freeKm: 2, pricingType: 'flat', pricePerStep: 5000 })).toBe(0);
  });

  it('freeKm chegarasida ham bepul (inclusive)', () => {
    expect(calcDeliveryFee({ distanceKm: 2, freeKm: 2, pricingType: 'flat', pricePerStep: 5000 })).toBe(0);
  });

  it('flat: freeKm dan tashqarida bo\'lsa doim bir xil narx', () => {
    expect(calcDeliveryFee({ distanceKm: 5, freeKm: 2, pricingType: 'flat', pricePerStep: 8000 })).toBe(8000);
    expect(calcDeliveryFee({ distanceKm: 20, freeKm: 2, pricingType: 'flat', pricePerStep: 8000 })).toBe(8000);
  });

  it('per_km: har boshlangan km uchun narxni oshiradi (ceil)', () => {
    // 3.2km over free zone → rounds up to 4 steps
    expect(calcDeliveryFee({ distanceKm: 5.2, freeKm: 2, pricingType: 'per_km', pricePerStep: 1000 })).toBe(4000);
  });

  it('per_500m: har 500m uchun narx qo\'shadi', () => {
    // 1km over → 2 steps of 500m
    expect(calcDeliveryFee({ distanceKm: 3, freeKm: 2, pricingType: 'per_500m', pricePerStep: 1000 })).toBe(2000);
  });

  it('per_100m: har 100m uchun narx qo\'shadi', () => {
    // 0.35km over → ceil(3.5) = 4 steps of 100m
    expect(calcDeliveryFee({ distanceKm: 2.35, freeKm: 2, pricingType: 'per_100m', pricePerStep: 500 })).toBe(2000);
  });
});

describe('pointInPolygon', () => {
  // A simple 4x4 square around lng∈[69,70], lat∈[41,42] (GeoJSON order: [lng, lat]).
  const square = {
    type: 'Polygon' as const,
    coordinates: [[
      [69, 41],
      [70, 41],
      [70, 42],
      [69, 42],
      [69, 41],
    ]] as [number, number][][],
  };

  it('kvadrat ichidagi nuqta uchun true', () => {
    expect(pointInPolygon(41.5, 69.5, square)).toBe(true);
  });

  it('kvadrat tashqarisidagi nuqta uchun false', () => {
    expect(pointInPolygon(43, 69.5, square)).toBe(false);
  });

  it('yaroqsiz (ring < 3 nuqta) poligon uchun false', () => {
    const degenerate = { type: 'Polygon' as const, coordinates: [[[69, 41], [70, 41]]] as [number, number][][] };
    expect(pointInPolygon(41.5, 69.5, degenerate)).toBe(false);
  });
});
