import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum AnalyticsEventType {
  ProductView = 'product_view',
  AddToCart = 'add_to_cart',
}

/**
 * Lightweight event log for the view → cart → order conversion funnel
 * (SPEC.md §5.3 "Konversiya: ko'rilgan → savat → buyurtma"). Deliberately has
 * no foreign-key relations or validation against Shop/ProductVariant — it's
 * written on every product view / add-to-cart tap from the mobile app, so the
 * hot write path stays a single cheap insert with no joins.
 */
@Entity({ name: 'analytics_events' })
@Index(['type', 'createdAt'])
@Index(['shopId', 'createdAt'])
export class AnalyticsEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: AnalyticsEventType })
  type!: AnalyticsEventType;

  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ type: 'uuid' })
  shopId!: string;

  @Column({ type: 'uuid', nullable: true })
  productVariantId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
