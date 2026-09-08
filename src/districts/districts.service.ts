import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { Repository } from 'typeorm';

import { District } from './entities/district.entity';
import { Region } from './entities/region.entity';

// Ray-casting Point in Polygon check
function isPointInPolygon(point: [number, number], vs: number[][]): boolean {
  const x = point[0];
  const y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0];
    const yi = vs[i][1];
    const xj = vs[j][0];
    const yj = vs[j][1];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeometry(pt: [number, number], geometry: any): boolean {
  if (!geometry || !geometry.coordinates) return false;
  if (geometry.type === 'Polygon') {
    return isPointInPolygon(pt, geometry.coordinates[0]);
  } else if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((poly: any) =>
      isPointInPolygon(pt, poly[0]),
    );
  }
  return false;
}

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

@Injectable()
export class DistrictsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DistrictsService.name);
  private cachedDistricts: District[] | null = null;

  constructor(
    @InjectRepository(Region)
    private readonly regionsRepo: Repository<Region>,
    @InjectRepository(District)
    private readonly districtsRepo: Repository<District>,
  ) {}

  async onApplicationBootstrap() {
    await this.ensureDistrictsSeeded();
    // Pre-cache districts in memory for ultra-fast point-in-polygon checks
    await this.loadCache();
  }

  /**
   * Idempotent seed: reads uzbekistan-districts.json and populates
   * regions and districts if missing.
   */
  async ensureDistrictsSeeded(): Promise<void> {
    try {
      const jsonPath = path.join(
        __dirname,
        '..',
        'database',
        'data',
        'uzbekistan-districts.json',
      );

      if (!fs.existsSync(jsonPath)) {
        this.logger.warn(`Districts seed file not found at ${jsonPath}`);
        return;
      }

      const raw = fs.readFileSync(jsonPath, 'utf-8');
      const data = JSON.parse(raw);

      const existingDistrictsCount = await this.districtsRepo.count();
      if (existingDistrictsCount >= data.districts.length) {
        this.logger.log(
          `Districts already seeded (${existingDistrictsCount} districts present).`,
        );
        return;
      }

      this.logger.log('Seeding Uzbekistan regions and districts...');

      // 1. Seed regions
      for (const r of data.regions) {
        await this.regionsRepo.upsert(
          {
            id: r.id,
            code: r.code,
            name: r.name,
            centerLat: r.centerLat,
            centerLng: r.centerLng,
          },
          ['id'],
        );
      }

      // 2. Seed districts in batches of 50
      const batchSize = 50;
      for (let i = 0; i < data.districts.length; i += batchSize) {
        const chunk = data.districts.slice(i, i + batchSize);
        await this.districtsRepo.upsert(chunk, ['id']);
      }

      const total = await this.districtsRepo.count();
      this.logger.log(
        `Successfully seeded ${total} districts across ${data.regions.length} regions.`,
      );
    } catch (err: any) {
      this.logger.error('Failed to seed districts:', err.message);
    }
  }

  private async loadCache(): Promise<void> {
    try {
      this.cachedDistricts = await this.districtsRepo.find({
        order: { nameKey: 'ASC' },
      });
      this.logger.log(
        `Cached ${this.cachedDistricts.length} districts for geofencing.`,
      );
    } catch (err: any) {
      this.logger.error('Failed to cache districts:', err.message);
    }
  }

  /**
   * Fast point-in-polygon detection for coordinates (lat, lng).
   * City enclaves are checked first so urban boundaries resolve accurately.
   * If point is outside polygons (e.g. border gaps), falls back to nearest center.
   */
  async findDistrictByCoords(
    latitude: number,
    longitude: number,
  ): Promise<District | null> {
    if (!this.cachedDistricts || this.cachedDistricts.length === 0) {
      await this.loadCache();
    }
    const all = this.cachedDistricts || [];
    if (all.length === 0) return null;

    const pt: [number, number] = [longitude, latitude];

    // Priority 1: Check city enclaves first (e.g. Karshi city, Bukhara city, Samarkand city)
    const cities = all.filter((d) => d.nameKey.toLowerCase().includes('city'));
    for (const city of cities) {
      if (pointInGeometry(pt, city.boundary)) {
        return city;
      }
    }

    // Priority 2: Check all other districts
    for (const d of all) {
      if (pointInGeometry(pt, d.boundary)) {
        return d;
      }
    }

    // Priority 3: Fallback to nearest centroid if coordinate falls slightly outside boundary
    let nearest: District | null = null;
    let minDistance = Infinity;
    for (const d of all) {
      const dist = haversineKm(latitude, longitude, d.centerLat, d.centerLng);
      if (dist < minDistance) {
        minDistance = dist;
        nearest = d;
      }
    }

    return nearest;
  }

  async getCurrentDistrict(
    latitude: number,
    longitude: number,
  ): Promise<District | null> {
    return this.findDistrictByCoords(latitude, longitude);
  }

  async findAll(): Promise<Omit<District, 'boundary'>[]> {
    return this.districtsRepo.find({
      select: {
        id: true,
        regionId: true,
        regionCode: true,
        nameKey: true,
        name: true,
        centerLat: true,
        centerLng: true,
      },
      order: { nameKey: 'ASC' },
    });
  }

  async findOne(id: string): Promise<District | null> {
    return this.districtsRepo.findOne({ where: { id } });
  }
}
