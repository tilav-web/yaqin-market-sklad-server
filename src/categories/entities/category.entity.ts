import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Tree,
  TreeChildren,
  TreeParent,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'categories' })
@Tree('materialized-path')
@Index(['slug'], { unique: true })
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  slug!: string;

  @Column({ type: 'varchar', length: 128 })
  nameUzLatn!: string;

  @Column({ type: 'varchar', length: 128 })
  nameUzCyrl!: string;

  @Column({ type: 'varchar', length: 128 })
  nameRu!: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  iconUrl!: string | null;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @TreeParent({ onDelete: 'SET NULL' })
  parent!: Category | null;

  @TreeChildren()
  children!: Category[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
