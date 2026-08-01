import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { ProductVariant } from '../../products/entities/product-variant.entity';
import { Order } from './order.entity';

@Entity({ name: 'order_items' })
@Index(['orderId'])
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  orderId!: string;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order!: Order;

  @Column({ type: 'uuid' })
  productVariantId!: string;

  @ManyToOne(() => ProductVariant, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productVariantId' })
  productVariant!: ProductVariant;

  @Column({ type: 'varchar', length: 256 })
  productName!: string;

  @Column({ type: 'int' })
  quantity!: number;

  @Column({ type: 'int' })
  unitPrice!: number;

  @Column({ type: 'int' })
  lineTotal!: number;

  @Column({ type: 'int', default: 0 })
  returnedQuantity!: number;

  /**
   * FIFO cost of goods for the units actually sold on this line (net of
   * returns). profit = lineTotal − costOfGoods. Filled at sale time by
   * consuming stock batches oldest-first; reduced when items are returned.
   */
  @Column({ type: 'int', default: 0 })
  costOfGoods!: number;

  /**
   * Asl belgisi (Data Matrix) markirovka kodlari — markirovka majburiy
   * tovarlarda har bir dona uchun bittadan skanerlangan kod. Yig'uvchi/kuryer
   * mobil ilovada skanerlaydi; fiskal chek qatoriga kiradi (qonun talabi).
   */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  markingCodes!: string[];

  /** Qo'llanilgan aksiya (snapshot uchun). */
  @Column({ type: 'uuid', nullable: true })
  appliedPromotionId!: string | null;

  @Column({ type: 'int', default: 0 })
  promotionDiscountAmount!: number;
}
