import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Kinds of admin actions worth a permanent trail — extend as new admin
 * mutations need one, rather than logging everything by default. */
export enum AuditAction {
  UserPromoted = 'user_promoted',
  UserDemoted = 'user_demoted',
  UserBlocked = 'user_blocked',
  UserUnblocked = 'user_unblocked',
  ShopActivated = 'shop_activated',
  ShopDeactivated = 'shop_deactivated',
  BalanceAdjusted = 'balance_adjusted',
  TransactionForceSettled = 'transaction_force_settled',
  TransactionForceRefunded = 'transaction_force_refunded',
  DebtForgiven = 'debt_forgiven',
  DebtExtended = 'debt_extended',
  PrimeSubscriptionExtended = 'prime_subscription_extended',
  OrderCommissionExempted = 'order_commission_exempted',
  OrderCommissionExemptRemoved = 'order_commission_exempt_removed',
  RiskFlagReviewed = 'risk_flag_reviewed',
}

@Entity({ name: 'admin_audit_logs' })
@Index(['targetType', 'targetId'])
@Index(['createdAt'])
export class AdminAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  adminUserId!: string;

  @Column({ type: 'enum', enum: AuditAction })
  action!: AuditAction;

  /** e.g. 'user', 'shop', 'seller_balance', 'seller_subscription' */
  @Column({ type: 'varchar', length: 32 })
  targetType!: string;

  @Column({ type: 'uuid', nullable: true })
  targetId!: string | null;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  /** Free-form extra context (amounts, before/after, days extended, etc). */
  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
