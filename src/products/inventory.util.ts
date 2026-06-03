import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { InventoryMovement, MovementType } from './entities/inventory-movement.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { StockBatch } from './entities/stock-batch.entity';

/**
 * Shared FIFO inventory primitives. These operate on a caller-supplied
 * EntityManager so they compose inside existing transactions (order placement,
 * stock receipt, returns). They keep three things consistent in one place:
 *   1. stock_batches — the FIFO lots (quantityRemaining)
 *   2. product_variants.stock — cached total = Σ quantityRemaining
 *   3. inventory_movements — the audit ledger
 */

export interface ReceiveBatchInput {
  variant: ProductVariant;
  quantity: number;
  costPrice: number;
  expiryDate?: Date | null;
  supplierName?: string | null;
  note?: string | null;
  userId?: string | null;
  /** Movement reason text (defaults to a generic "kirim"). */
  reason?: string;
  /** Marks the lot as restocked-from-return rather than a purchase. */
  isReturn?: boolean;
  /** Movement type override (default In; returns pass Returned). */
  movementType?: MovementType;
  orderId?: string | null;
}

/** Receive a new lot of stock and append it to the FIFO queue. */
export async function receiveBatch(
  manager: EntityManager,
  input: ReceiveBatchInput,
): Promise<StockBatch> {
  if (input.quantity <= 0) throw new BadRequestException('Miqdor 0 dan katta bo\'lishi kerak');
  const { variant } = input;
  const before = variant.stock;

  const batch = await manager.save(
    manager.create(StockBatch, {
      productVariantId: variant.id,
      shopId: variant.shopId,
      costPrice: Math.max(0, Math.round(input.costPrice)),
      quantityReceived: input.quantity,
      quantityRemaining: input.quantity,
      expiryDate: input.expiryDate ?? null,
      supplierName: input.supplierName ?? null,
      note: input.note ?? null,
      isReturn: input.isReturn ?? false,
      performedByUserId: input.userId ?? null,
      receivedAt: new Date(),
    }),
  );

  variant.stock = before + input.quantity;
  await manager.save(variant);

  await manager.save(
    manager.create(InventoryMovement, {
      productVariantId: variant.id,
      type: input.movementType ?? MovementType.In,
      quantity: input.quantity,
      beforeStock: before,
      afterStock: variant.stock,
      reason: input.reason ?? 'Kirim',
      orderId: input.orderId ?? null,
      performedByUserId: input.userId ?? null,
    }),
  );

  return batch;
}

export interface ConsumeInput {
  variant: ProductVariant;
  quantity: number;
  type: MovementType;
  orderId?: string | null;
  userId?: string | null;
  reason?: string;
}

/**
 * Consume `quantity` units from the oldest non-empty batches (FIFO) and return
 * the total cost of goods removed. Used for sales, write-offs and expiries.
 */
export async function consumeFifo(
  manager: EntityManager,
  input: ConsumeInput,
): Promise<{ costOfGoods: number }> {
  const { variant } = input;
  let need = input.quantity;
  if (need <= 0) return { costOfGoods: 0 };
  if (variant.stock < need) {
    throw new BadRequestException(`"${variant.name}" qoldig'i yetarli emas`);
  }

  const batches = await manager.find(StockBatch, {
    where: { productVariantId: variant.id },
    order: { receivedAt: 'ASC', createdAt: 'ASC' },
  });

  let costOfGoods = 0;
  for (const batch of batches) {
    if (need <= 0) break;
    if (batch.quantityRemaining <= 0) continue;
    const take = Math.min(batch.quantityRemaining, need);
    batch.quantityRemaining -= take;
    costOfGoods += take * batch.costPrice;
    need -= take;
    await manager.save(batch);
  }

  // Fallback: legacy stock with no (or insufficient) batches. Still let the
  // sale proceed — cost simply counts as 0 for the uncovered units.
  const before = variant.stock;
  variant.stock = before - input.quantity;
  await manager.save(variant);

  await manager.save(
    manager.create(InventoryMovement, {
      productVariantId: variant.id,
      type: input.type,
      quantity: input.quantity,
      beforeStock: before,
      afterStock: variant.stock,
      reason: input.reason ?? null,
      orderId: input.orderId ?? null,
      performedByUserId: input.userId ?? null,
    }),
  );

  return { costOfGoods };
}

/**
 * Put returned units back on the shelf as a fresh FIFO lot priced at the cost
 * they were originally sold for, so future sales and profit stay accurate.
 */
export async function restockReturn(
  manager: EntityManager,
  input: {
    variant: ProductVariant;
    quantity: number;
    unitCost: number;
    orderId?: string | null;
    userId?: string | null;
    reason?: string;
  },
): Promise<void> {
  if (input.quantity <= 0) return;
  await receiveBatch(manager, {
    variant: input.variant,
    quantity: input.quantity,
    costPrice: input.unitCost,
    isReturn: true,
    movementType: MovementType.Returned,
    orderId: input.orderId ?? null,
    userId: input.userId ?? null,
    reason: input.reason ?? 'Qaytarildi',
  });
}

/** Per-unit cost recorded against an order line (0 when nothing was sold). */
export function unitCostOf(costOfGoods: number, quantity: number): number {
  if (quantity <= 0) return 0;
  return Math.round(costOfGoods / quantity);
}
