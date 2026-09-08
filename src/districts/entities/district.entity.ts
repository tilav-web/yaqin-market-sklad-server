import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import type { LocalizedText } from '../../common/types/localized-text.type';
import { Region } from './region.entity';

@Entity({ name: 'districts' })
@Index(['regionId'])
export class District {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  regionId!: string;

  @ManyToOne(() => Region, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'regionId' })
  region!: Region;

  @Column({ type: 'varchar', length: 64 })
  regionCode!: string;

  @Column({ type: 'varchar', length: 128 })
  nameKey!: string;

  @Column({
    type: 'jsonb',
    default: () => '\'{"uz":"","kr":"","ru":""}\'::jsonb',
  })
  name!: LocalizedText;

  @Column({ type: 'double precision' })
  centerLat!: number;

  @Column({ type: 'double precision' })
  centerLng!: number;

  /** GeoJSON boundary geometry (Polygon or MultiPolygon) */
  @Column({ type: 'jsonb' })
  boundary!: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: any;
  };
}
