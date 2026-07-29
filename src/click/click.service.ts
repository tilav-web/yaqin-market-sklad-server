import * as crypto from 'crypto';

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { Order, PaymentMethod, PaymentStatus, isTerminalOrderStatus } from '../orders/entities/order.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ClickWebhookDto } from './click-webhook.dto';
import { ClickPaymentTransaction, ClickTxStatus } from './click-payment-transaction.entity';

type ClickResponse = {
  click_trans_id?: string;
  merchant_trans_id?: string;
  merchant_prepare_id?: string;
  merchant_confirm_id?: string;
  error: string;
  error_note: string;
};

const ERR = {
  OK: 0,
  SIGN_FAILED: -1,
  INVALID_AMOUNT: -2,
  ACTION_NOT_FOUND: -3,
  ALREADY_PAID: -4,
  TX_NOT_FOUND: -6,
  CONFIG_ERROR: -8,
  TX_CANCELLED: -9,
} as const;

function errRes(code: number, note: string): ClickResponse {
  return { error: String(code), error_note: note };
}

@Injectable()
export class ClickService {
  private readonly logger = new Logger(ClickService.name);

  constructor(
    @InjectRepository(ClickPaymentTransaction)
    private readonly txRepo: Repository<ClickPaymentTransaction>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    private readonly dataSource: DataSource,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Returns the Click payment URL for an order. */
  async getPaymentUrl(orderId: string, userId: string): Promise<{ url: string }> {
    const order = await this.orderRepo.findOne({ where: { id: orderId, userId } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.paymentMethod !== PaymentMethod.ClickOnline) {
      throw new BadRequestException('Bu buyurtma uchun online to\'lov yoqilmagan');
    }
    if (order.paymentStatus === PaymentStatus.Paid) {
      throw new BadRequestException('Buyurtma allaqachon to\'langan');
    }
    if (isTerminalOrderStatus(order.status)) {
      throw new BadRequestException('Bekor qilingan buyurtma uchun to\'lov qilib bo\'lmaydi');
    }
    return { url: this.buildUrl(order.id, order.total) };
  }

  async prepare(dto: ClickWebhookDto): Promise<ClickResponse> {
    const { click_trans_id, merchant_trans_id, amount, action, sign_string, sign_time, service_id } = dto;

    const cfgErr = this.checkConfig(service_id);
    if (cfgErr) return cfgErr;
    if (action !== '0') return errRes(ERR.ACTION_NOT_FOUND, 'action must be 0');
    if (!this.checkSign({ click_trans_id, service_id, merchant_trans_id, amount, action, sign_time, sign_string })) {
      return errRes(ERR.SIGN_FAILED, 'sign check failed');
    }

    const order = await this.orderRepo.findOne({ where: { id: merchant_trans_id } });
    if (!order) return errRes(ERR.TX_NOT_FOUND, 'order not found');
    if (order.paymentStatus === PaymentStatus.Paid) return errRes(ERR.ALREADY_PAID, 'already paid');
    if (!this.amountMatch(order.total, amount)) return errRes(ERR.INVALID_AMOUNT, 'amount mismatch');

    return this.dataSource.transaction(async (em) => {
      // Lock any row already tracking this order (mirrors complete()'s
      // locking) so two concurrent webhook calls for the same order can't
      // both see "nothing exists yet" and race to insert a duplicate.
      let tx = click_trans_id
        ? await em.findOne(ClickPaymentTransaction, {
            where: { clickTransId: click_trans_id },
            lock: { mode: 'pessimistic_write' },
          })
        : null;
      if (!tx) {
        tx = await em.findOne(ClickPaymentTransaction, {
          where: { orderId: order.id },
          lock: { mode: 'pessimistic_write' },
        });
      }
      if (tx?.status === ClickTxStatus.Cancelled) {
        // A row Click itself cancelled (it carries a click_trans_id or a
        // Merchant API payment_id) must stay dead — Click's docs require -9
        // on any retry of a cancelled Click transaction. But a row cancelled
        // by a declined card_token/payment attempt has neither id: it only
        // records our failed saved-card try, and must not block the user
        // from paying the same order through the redirect flow — revive it.
        if (tx.clickTransId || tx.clickPaymentId) {
          return errRes(ERR.TX_CANCELLED, 'transaction cancelled');
        }
        tx.status = ClickTxStatus.Pending;
        tx.errorCode = null;
        tx.errorNote = null;
      }

      if (!tx) {
        tx = em.create(ClickPaymentTransaction, {
          orderId: order.id,
          clickTransId: click_trans_id ?? null,
          amount: String(order.total),
          status: ClickTxStatus.Pending,
        });
      } else if (click_trans_id) {
        tx.clickTransId = click_trans_id;
      }

      let saved: ClickPaymentTransaction;
      try {
        saved = await em.save(ClickPaymentTransaction, tx);
      } catch (e: any) {
        // Unique orderId race: a concurrent prepare() call inserted first —
        // fall back to locking and updating the row that won the race.
        if (e?.code === '23505') {
          const winner = await em.findOne(ClickPaymentTransaction, {
            where: { orderId: order.id },
            lock: { mode: 'pessimistic_write' },
          });
          if (!winner) throw e;
          if (click_trans_id) winner.clickTransId = click_trans_id;
          saved = await em.save(ClickPaymentTransaction, winner);
        } else {
          throw e;
        }
      }

      return {
        click_trans_id,
        merchant_trans_id,
        merchant_prepare_id: saved.id,
        error: String(ERR.OK),
        error_note: 'SUCCESS',
      };
    });
  }

  async complete(dto: ClickWebhookDto): Promise<ClickResponse> {
    const {
      click_trans_id, merchant_trans_id, merchant_prepare_id,
      amount, action, sign_string, sign_time, service_id, error: clickError,
    } = dto;

    const cfgErr = this.checkConfig(service_id);
    if (cfgErr) return cfgErr;
    if (action !== '1') return errRes(ERR.ACTION_NOT_FOUND, 'action must be 1');
    if (!merchant_prepare_id) return errRes(ERR.TX_NOT_FOUND, 'merchant_prepare_id missing');
    if (!this.checkSign({ click_trans_id, service_id, merchant_trans_id, merchant_prepare_id, amount, action, sign_time, sign_string })) {
      return errRes(ERR.SIGN_FAILED, 'sign check failed');
    }

    const order = await this.orderRepo.findOne({ where: { id: merchant_trans_id } });
    if (!order) return errRes(ERR.TX_NOT_FOUND, 'order not found');
    if (order.paymentStatus === PaymentStatus.Paid) return errRes(ERR.ALREADY_PAID, 'already paid');
    if (!this.amountMatch(order.total, amount)) return errRes(ERR.INVALID_AMOUNT, 'amount mismatch');

    const result = await this.dataSource.transaction(async (em) => {
      const tx = await em.findOne(ClickPaymentTransaction, {
        where: { id: merchant_prepare_id, orderId: order.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!tx) return errRes(ERR.TX_NOT_FOUND, 'transaction not found');
      if (tx.status === ClickTxStatus.Cancelled) return errRes(ERR.TX_CANCELLED, 'transaction cancelled');
      if (tx.status === ClickTxStatus.Success) return errRes(ERR.ALREADY_PAID, 'already paid');

      const clickErrCode = Number(clickError ?? 0);

      if (clickErrCode < 0) {
        tx.status = ClickTxStatus.Cancelled;
        await em.save(ClickPaymentTransaction, tx);
        await em.update(Order, order.id, { paymentStatus: PaymentStatus.Failed });
        return errRes(ERR.TX_CANCELLED, 'payment cancelled by user');
      }

      tx.status = ClickTxStatus.Success;
      tx.clickTransId = click_trans_id;
      await em.save(ClickPaymentTransaction, tx);
      await em.update(Order, order.id, { paymentStatus: PaymentStatus.Paid });

      return {
        click_trans_id,
        merchant_trans_id,
        merchant_confirm_id: tx.id,
        error: String(ERR.OK),
        error_note: 'SUCCESS',
      };
    });

    // Notify customer via Socket.IO after payment confirmed
    if (!('error' in result) || result.error === String(ERR.OK)) {
      if (order.userId) this.realtime.emitToUser(order.userId, 'order:payment_confirmed', { orderId: order.id });
    }

    return result;
  }

  // ── private helpers ──────────────────────────────────────────────────────────

  private buildUrl(orderId: string, amount: number): string {
    const service_id = process.env.CLICK_SERVICE_ID;
    const merchant_id = process.env.CLICK_MERCHANT_ID;
    const merchant_user_id = process.env.CLICK_MERCHANT_USER_ID;
    const returnUrlBase = process.env.CLICK_RETURN_URL;
    if (!service_id || !merchant_id || !merchant_user_id || !returnUrlBase) {
      throw new Error('Click env vars are missing');
    }
    // The order id rides along in the path (not appended as a query param by
    // us) so it survives however Click appends its own query params
    // (paymentStatus, etc.) when it redirects the browser back here — that
    // redirect is a UX convenience only, never the authoritative payment
    // confirmation (that's prepare/complete), so returnPage() just needs to
    // know which order to send the customer back to.
    const params = new URLSearchParams({
      service_id,
      merchant_id,
      amount: amount.toFixed(2),
      transaction_param: orderId,
      merchant_user_id,
      return_url: `${returnUrlBase}/${orderId}`,
    });
    return `https://my.click.uz/services/pay?${params.toString()}`;
  }

  private checkConfig(serviceId: string): ClickResponse | null {
    const expected = process.env.CLICK_SERVICE_ID;
    const secret = process.env.CLICK_SECRET_KEY;
    if (!expected || !secret) {
      this.logger.error('CLICK_SERVICE_ID or CLICK_SECRET_KEY not set');
      return errRes(ERR.CONFIG_ERROR, 'configuration error');
    }
    if (serviceId !== expected) return errRes(ERR.CONFIG_ERROR, 'invalid service_id');
    return null;
  }

  private checkSign(params: {
    click_trans_id: string;
    service_id: string;
    merchant_trans_id: string;
    merchant_prepare_id?: string;
    amount: string;
    action: string;
    sign_time: string;
    sign_string: string;
  }): boolean {
    const secret = process.env.CLICK_SECRET_KEY ?? '';
    const raw = [
      params.click_trans_id,
      params.service_id,
      secret,
      params.merchant_trans_id,
      params.merchant_prepare_id ?? '',
      params.amount,
      params.action,
      params.sign_time,
    ].join('');
    const expected = crypto.createHash('md5').update(raw).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(params.sign_string ?? ''));
    } catch {
      return false;
    }
  }

  private amountMatch(orderTotal: number, requestAmount: string): boolean {
    return Math.abs(orderTotal - Number(requestAmount)) < 0.01;
  }
}
