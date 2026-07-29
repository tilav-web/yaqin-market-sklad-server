import * as crypto from 'crypto';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EnvironmentVariables } from '../config/configuration';
import { mapClickErrorMessage } from './click-error-messages';

/**
 * Client for Click's *Merchant* API (api.click.uz/v2/merchant) — the
 * card_token endpoints that let a saved card be charged without redirecting
 * to my.click.uz. This is a different API from the Shop API used by
 * ClickService (click.controller.ts prepare/complete webhooks): different
 * base URL, different auth (a per-request `Auth` header instead of an
 * md5 sign_string), different error shape (`error_code`/`error_note`).
 *
 * Raw card_number/expire_date pass through this service on their way to
 * Click — they are never persisted (see SavedCard, which stores only the
 * resulting card_token + a masked number).
 */

const MERCHANT_API_BASE = 'https://api.click.uz/v2/merchant/';

interface ClickMerchantResponse {
  error_code: number;
  error_note: string;
  [key: string]: unknown;
}

/** Carries Click's raw error_code/error_note so callers can persist them for diagnostics. */
export class ClickDeclinedException extends BadRequestException {
  constructor(
    public readonly errorCode: number,
    public readonly errorNote: string,
  ) {
    super(mapClickErrorMessage(errorCode, errorNote));
  }
}

@Injectable()
export class ClickMerchantService {
  private readonly logger = new Logger(ClickMerchantService.name);

  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  /** Step 1: request a card token. Click sends an SMS code to the card's linked phone. */
  async requestToken(cardNumber: string, expireDate: string): Promise<{ cardToken: string; phoneNumber: string | null }> {
    const res = await this.request<{ card_token: string; phone_number?: string }>('POST', 'card_token/request', {
      service_id: this.serviceId(),
      card_number: cardNumber,
      expire_date: expireDate,
      // 0 = persistent token (reusable for future payments), matching the
      // "saved card" product decision — 1 would delete the token after a
      // single payment.
      temporary: 0,
    });
    return { cardToken: res.card_token, phoneNumber: res.phone_number ?? null };
  }

  /** Step 2: confirm the SMS code, activating the token. */
  async verifyToken(cardToken: string, smsCode: string): Promise<{ cardNumberMasked: string | null }> {
    const res = await this.request<{ card_number?: string }>('POST', 'card_token/verify', {
      service_id: this.serviceId(),
      card_token: cardToken,
      sms_code: smsCode,
    });
    return { cardNumberMasked: res.card_number ?? null };
  }

  /** Step 3: charge a verified token — no redirect, no further user interaction. */
  async payWithToken(cardToken: string, amount: number, merchantTransId: string): Promise<{ paymentId: string }> {
    const res = await this.request<{ payment_id: string | number }>('POST', 'card_token/payment', {
      service_id: this.serviceId(),
      card_token: cardToken,
      amount,
      // Click's own sources disagree on this field's name: docs.click.uz's
      // "Payment with Card Token" example uses `transaction_parameter`, but
      // the official click-llc/click-integration-php reference SDK sends
      // `merchant_trans_id` (matching every other Click endpoint). Sending
      // both is a harmless hedge until this is confirmed one way or the
      // other with Click support — see ../../CLICK_PAYMENT_REFERENCE.md.
      merchant_trans_id: merchantTransId,
      transaction_parameter: merchantTransId,
    });
    return { paymentId: String(res.payment_id) };
  }

  /** Removes a saved token on Click's side (called before deleting our own row). */
  async deleteToken(cardToken: string): Promise<void> {
    await this.request('DELETE', `card_token/${this.serviceId()}/${encodeURIComponent(cardToken)}`);
  }

  /**
   * Cancels a completed payment, returning the money to the customer's card
   * (payment/reversal). Click only allows this for current-reporting-month
   * payments (previous month: only on the 1st) and may see it rejected by
   * the card network — callers must treat failure as retryable/manual.
   */
  async reversePayment(paymentId: string): Promise<void> {
    await this.request('DELETE', `payment/reversal/${this.serviceId()}/${encodeURIComponent(paymentId)}`);
  }

  // ── private helpers ──────────────────────────────────────────────────────

  private serviceId(): string {
    const id = this.config.get('CLICK_SERVICE_ID', { infer: true });
    if (!id) throw new Error('CLICK_SERVICE_ID env var is missing');
    return id;
  }

  /** `Auth: {merchant_user_id}:{sha1(timestamp + secret_key)}:{timestamp}` — see Click's Merchant API docs. */
  private authHeader(): string {
    const userId = this.config.get('CLICK_MERCHANT_USER_ID', { infer: true });
    const secret = this.config.get('CLICK_SECRET_KEY', { infer: true });
    if (!userId || !secret) throw new Error('CLICK_MERCHANT_USER_ID or CLICK_SECRET_KEY env var is missing');
    const timestamp = Math.floor(Date.now() / 1000);
    const digest = crypto.createHash('sha1').update(`${timestamp}${secret}`).digest('hex');
    return `${userId}:${digest}:${timestamp}`;
  }

  private async request<T extends Record<string, unknown> = Record<string, unknown>>(
    method: 'POST' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T & ClickMerchantResponse> {
    let res: Response;
    try {
      res = await fetch(`${MERCHANT_API_BASE}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Auth: this.authHeader(),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      this.logger.error(`Click Merchant API request failed: ${(err as Error).message}`);
      throw new BadRequestException("Click bilan bog'lanib bo'lmadi, birozdan so'ng qayta urinib ko'ring");
    }

    const json = (await res.json().catch(() => null)) as (T & ClickMerchantResponse) | null;
    // Full request/response trace for payment calls only — this path carries
    // no PAN/sms_code (unlike card_token/request|verify, which must never be
    // logged), and the trace is the evidence Click support asks for while the
    // account activation issues are being resolved.
    if (path === 'card_token/payment') {
      this.logger.log(
        `card_token/payment trace: request=${JSON.stringify(body)} response(HTTP ${res.status})=${JSON.stringify(json)}`,
      );
    }
    if (!json || typeof json.error_code !== 'number') {
      this.logger.error(`Click Merchant API unexpected response: HTTP ${res.status}`);
      throw new BadRequestException("Click javobini o'qib bo'lmadi");
    }
    if (json.error_code !== 0) {
      const merchantTransId = body?.merchant_trans_id ?? null;
      this.logger.warn(
        `Click Merchant API declined ${path}: error_code=${json.error_code} error_note=${json.error_note} merchant_trans_id=${merchantTransId}`,
      );
      throw new ClickDeclinedException(json.error_code, json.error_note);
    }
    return json;
  }
}
