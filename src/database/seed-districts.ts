import * as fs from 'fs';
import * as path from 'path';
import { AppDataSource } from './data-source';
import { District } from '../districts/entities/district.entity';
import { Region } from '../districts/entities/region.entity';

interface DistrictJsonData {
  regions: Array<{
    id: string;
    code: string;
    name: { uz: string; ru: string; kr: string };
    centerLat: number;
    centerLng: number;
  }>;
  districts: Array<{
    id: string;
    regionId: string;
    regionCode: string;
    nameKey: string;
    name: { uz: string; ru: string; kr: string };
    centerLat: number;
    centerLng: number;
    boundary: {
      type: 'Polygon' | 'MultiPolygon';
      coordinates: any;
    };
  }>;
}

async function seedDistricts(): Promise<void> {
  console.log('--- Seeding 209 Uzbekistan Regions and Districts ---');
  await AppDataSource.initialize();

  const regionsRepo = AppDataSource.getRepository(Region);
  const districtsRepo = AppDataSource.getRepository(District);

  const jsonPath = path.join(__dirname, 'data', 'uzbekistan-districts.json');

  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Data file not found at ${jsonPath}`);
  }

  const raw = fs.readFileSync(jsonPath, 'utf-8');
  const data: DistrictJsonData = JSON.parse(raw);

  console.log(`1. Upserting ${data.regions.length} regions...`);
  for (const r of data.regions) {
    await regionsRepo.upsert(
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

  console.log(
    `2. Upserting ${data.districts.length} districts and municipal cities...`,
  );
  const batchSize = 50;
  for (let i = 0; i < data.districts.length; i += batchSize) {
    const chunk = data.districts.slice(i, i + batchSize);
    await districtsRepo.upsert(
      chunk.map((d) => ({
        id: d.id,
        regionId: d.regionId,
        regionCode: d.regionCode,
        nameKey: d.nameKey,
        name: d.name,
        centerLat: d.centerLat,
        centerLng: d.centerLng,
        boundary: d.boundary,
      })),
      ['id'],
    );
  }

  const totalDistricts = await districtsRepo.count();
  const totalRegions = await regionsRepo.count();
  console.log('🎉 Seeding successfully completed!');
  console.log(`   - Regions in DB:   ${totalRegions}`);
  console.log(`   - Districts in DB: ${totalDistricts}`);

  await AppDataSource.destroy();
}

seedDistricts().catch(async (err) => {
  console.error('Seed districts error:', err);
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
  process.exit(1);
});
