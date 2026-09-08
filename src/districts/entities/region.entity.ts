import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { LocalizedText } from '../../common/types/localized-text.type';

@Entity({ name: 'regions' })
export class Region {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  code!: string;

  @Column({
    type: 'jsonb',
    default: () => '\'{"uz":"","kr":"","ru":""}\'::jsonb',
  })
  name!: LocalizedText;

  @Column({ type: 'double precision' })
  centerLat!: number;

  @Column({ type: 'double precision' })
  centerLng!: number;
}
