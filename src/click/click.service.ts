import * as crypto from 'crypto';

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';

import type { EnvironmentVariables } from '../config/configuration';
import { FiscalService } from '../fiscal/fiscal.service';
import {
  Order,
  PaymentMethod,
  PaymentStatus,
  isTerminalOrderStatus,
} from '../orders/entities/order.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SETTING_KEYS } from '../settings/entities/global-setting.entity';
import { SettingsService } from '../settings/settings.service';
import { ClickMerchantService } from './click-merchant.service';
import { ClickWebhookDto } from './click-webhook.dto';
import {
  ClickPaymentTransaction,
  ClickTxStatus,
} from './click-payment-transaction.entity';

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
    private readonly merchant: ClickMerchantService,
    private readonly settings: SettingsService,
    private readonly fiscal: FiscalService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /**
   * Reverses an order's captured Click payment back to the customer's card
   * and stamps Order.refundedAt. Idempotent: an already-refunded order
   * returns true immediately, an unpaid/cash order returns false. A false
   * return with a paid order means the reversal must be retried (see
   * OrdersService.retryPendingRefunds) or handled manually.
   */
  async refundPaidOrder(orderId: string): Promise<boolean> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) return false;
    if (order.refundedAt) return true;
    if (
      order.paymentMethod !== PaymentMethod.ClickOnline ||
      order.paymentStatus !== PaymentStatus.Paid
    ) {
      return false;
    }

    const tx = await this.txRepo.findOne({
      where: { orderId, status: ClickTxStatus.Success },
    });
    const paymentId = tx?.clickPaymentId ?? tx?.clickPaydocId ?? null;
    if (!paymentId) {
      this.logger.warn(
        `refundPaidOrder: order ${orderId} has no Click payment_id — manual reversal needed`,
      );
      return false;
    }

    try {
      await this.merchant.reversePayment(paymentId);
    } catch (err) {
      this.logger.warn(
        `refundPaidOrder: reversal failed for order ${orderId} payment ${paymentId}: ${(err as Error).message}`,
      );
      return false;
    }

    // IsNull guard: a concurrent refund attempt (cancel path racing the retry
    // cron) must not stamp twice.
    const stamped = await this.orderRepo.update(
      { id: orderId, refundedAt: IsNull() },
      { refundedAt: new Date() },
    );
    this.logger.log(
      `Order ${orderId}: Click payment ${paymentId} reversed to the customer's card`,
    );
    if (order.userId)
      this.realtime.emitToUser(order.userId, 'order:refunded', { orderId });
    // Pul qaytdi → qaytarish cheki (asl sotuv chekini soliq tizimida bekor
    // qiladi; mijoz cashback olgan bo'lsa uni soliq tizimi o'zi qaytarib
    // oladi). Faqat birinchi stamplagan chaqiruv chiqaradi — poyga yo'q.
    if (stamped.affected) void this.fiscal.createRefundReceipt(orderId);
    return true;
  }

  /** Returns the Click payment URL for an order. */
  async getPaymentUrl(
    orderId: string,
    userId: string,
  ): Promise<{ url: string }> {
    const order = await this.orderRepo.findOne({
      where: { id: orderId, userId },
    });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.paymentMethod !== PaymentMethod.ClickOnline) {
      throw new BadRequestException(
        "Bu buyurtma uchun online to'lov yoqilmagan",
      );
    }
    if (order.paymentStatus === PaymentStatus.Paid) {
      throw new BadRequestException("Buyurtma allaqachon to'langan");
    }
    if (isTerminalOrderStatus(order.status)) {
      throw new BadRequestException(
        "Bekor qilingan buyurtma uchun to'lov qilib bo'lmaydi",
      );
    }
    return { url: this.buildUrl(order.id, order.total) };
  }

  async prepare(dto: ClickWebhookDto): Promise<ClickResponse> {
    const {
      click_trans_id,
      click_paydoc_id,
      merchant_trans_id,
      amount,
      action,
      sign_string,
      sign_time,
      service_id,
    } = dto;

    const cfgErr = this.checkConfig(service_id);
    if (cfgErr) return cfgErr;
    if (action !== '0') return errRes(ERR.ACTION_NOT_FOUND, 'action must be 0');
    if (
      !this.checkSign({
        click_trans_id,
        service_id,
        merchant_trans_id,
        amount,
        action,
        sign_time,
        sign_string,
      })
    ) {
      return errRes(ERR.SIGN_FAILED, 'sign check failed');
    }

    const order = await this.orderRepo.findOne({
      where: { id: merchant_trans_id },
    });
    if (!order) return errRes(ERR.TX_NOT_FOUND, 'order not found');
    if (order.paymentStatus === PaymentStatus.Paid)
      return errRes(ERR.ALREADY_PAID, 'already paid');
    if (!this.amountMatch(order.total, amount))
      return errRes(ERR.INVALID_AMOUNT, 'amount mismatch');

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
        // -9 is only for re-confirming the SAME cancelled Click transaction
        // (docs: "repeated attempt to confirm a previously cancelled
        // payment") — i.e. Click retrying the click_trans_id we already
        // cancelled — or a row that somehow carries a Merchant API payment.
        // Everything else is a legitimate NEW attempt at paying this order
        // (a fresh click_trans_id after a user-cancelled payment, or a row
        // cancelled by our own declined card_token try): revive it, or the
        // order stays unpayable forever after a single failed attempt.
        const sameClickTx =
          !!tx.clickTransId && tx.clickTransId === click_trans_id;
        if (sameClickTx || tx.clickPaymentId) {
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
          clickPaydocId: click_paydoc_id ?? null,
          amount: String(order.total),
          status: ClickTxStatus.Pending,
        });
      } else {
        if (click_trans_id) tx.clickTransId = click_trans_id;
        if (click_paydoc_id) tx.clickPaydocId = click_paydoc_id;
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
          if (click_paydoc_id) winner.clickPaydocId = click_paydoc_id;
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
      click_trans_id,
      click_paydoc_id,
      merchant_trans_id,
      merchant_prepare_id,
      amount,
      action,
      sign_string,
      sign_time,
      service_id,
      error: clickError,
    } = dto;

    const cfgErr = this.checkConfig(service_id);
    if (cfgErr) return cfgErr;
    if (action !== '1') return errRes(ERR.ACTION_NOT_FOUND, 'action must be 1');
    if (!merchant_prepare_id)
      return errRes(ERR.TX_NOT_FOUND, 'merchant_prepare_id missing');
    if (
      !this.checkSign({
        click_trans_id,
        service_id,
        merchant_trans_id,
        merchant_prepare_id,
        amount,
        action,
        sign_time,
        sign_string,
      })
    ) {
      return errRes(ERR.SIGN_FAILED, 'sign check failed');
    }

    const order = await this.orderRepo.findOne({
      where: { id: merchant_trans_id },
    });
    if (!order) return errRes(ERR.TX_NOT_FOUND, 'order not found');
    if (order.paymentStatus === PaymentStatus.Paid)
      return errRes(ERR.ALREADY_PAID, 'already paid');
    if (!this.amountMatch(order.total, amount))
      return errRes(ERR.INVALID_AMOUNT, 'amount mismatch');

    const result = await this.dataSource.transaction(async (em) => {
      const tx = await em.findOne(ClickPaymentTransaction, {
        where: { id: merchant_prepare_id, orderId: order.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!tx) return errRes(ERR.TX_NOT_FOUND, 'transaction not found');
      if (tx.status === ClickTxStatus.Cancelled)
        return errRes(ERR.TX_CANCELLED, 'transaction cancelled');
      if (tx.status === ClickTxStatus.Success)
        return errRes(ERR.ALREADY_PAID, 'already paid');

      const clickErrCode = Number(clickError ?? 0);

      // Recorded on both outcomes: this is the Merchant API payment_id, the
      // key needed later for payment/status lookups and payment/reversal.
      if (click_paydoc_id) tx.clickPaydocId = click_paydoc_id;

      if (clickErrCode < 0) {
        tx.status = ClickTxStatus.Cancelled;
        await em.save(ClickPaymentTransaction, tx);
        await em.update(Order, order.id, {
          paymentStatus: PaymentStatus.Failed,
        });
        return errRes(ERR.TX_CANCELLED, 'payment cancelled by user');
      }

      tx.status = ClickTxStatus.Success;
      tx.clickTransId = click_trans_id;
      await em.save(ClickPaymentTransaction, tx);
      // Click o'z ekvayring haqini totaldan ushlab qoladi — real marja
      // hisobi uchun to'lov paytidagi foiz bo'yicha snapshot qilinadi
      // (platforma yutadi, seller hisob-kitobiga ta'sir qilmaydi).
      const feePercent = this.settings.getNumber(
        SETTING_KEYS.CLICK_FEE_PERCENT,
        0,
      );
      await em.update(Order, order.id, {
        paymentStatus: PaymentStatus.Paid,
        providerFeeAmount: Math.round((order.total * feePercent) / 100),
        providerFeePercentSnapshot: feePercent,
      });

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
      if (order.userId)
        this.realtime.emitToUser(order.userId, 'order:payment_confirmed', {
          orderId: order.id,
        });
      // Qonun: chek to'lov qabul qilingan paytda chiqariladi. Fire-and-forget
      // — chek muammosi to'lov webhookini yiqitmasligi kerak (servis o'zi
      // xatoni yutadi va log qiladi).
      void this.fiscal.createSaleReceipt(order.id);
    }

    return result;
  }

  // ── private helpers ──────────────────────────────────────────────────────────

  private buildUrl(orderId: string, amount: number): string {
    const service_id = this.config.get('CLICK_SERVICE_ID', { infer: true });
    const merchant_id = this.config.get('CLICK_MERCHANT_ID', { infer: true });
    const merchant_user_id = this.config.get('CLICK_MERCHANT_USER_ID', {
      infer: true,
    });
    const returnUrlBase = this.config.get('CLICK_RETURN_URL', { infer: true });
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
    const expected = this.config.get('CLICK_SERVICE_ID', { infer: true });
    const secret = this.config.get('CLICK_SECRET_KEY', { infer: true });
    if (!expected || !secret) {
      this.logger.error('CLICK_SERVICE_ID or CLICK_SECRET_KEY not set');
      return errRes(ERR.CONFIG_ERROR, 'configuration error');
    }
    if (serviceId !== expected)
      return errRes(ERR.CONFIG_ERROR, 'invalid service_id');
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
    const secret = this.config.get('CLICK_SECRET_KEY', { infer: true }) ?? '';
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
      return crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(params.sign_string ?? ''),
      );
    } catch {
      return false;
    }
  }

  private amountMatch(orderTotal: number, requestAmount: string): boolean {
    return Math.abs(orderTotal - Number(requestAmount)) < 0.01;
  }
}
