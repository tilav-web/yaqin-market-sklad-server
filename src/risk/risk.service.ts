import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { haversineKm } from '../geo/geo.util';
import { LocationEvidence } from '../geo/location-evidence';
import { Order } from '../orders/entities/order.entity';
import { SETTING_KEYS } from '../settings/entities/global-setting.entity';
import { SettingsService } from '../settings/settings.service';
import { DeviceAccount } from './entities/device-account.entity';
import {
  RiskFlagStatus,
  RiskRule,
  RiskSeverity,
  RiskSubjectType,
} from './entities/risk-flag.entity';
import { RiskFlagsService } from './risk-flags.service';
import { RiskHandshakeService } from './risk-handshake.service';
import { RiskPingService } from './risk-ping.service';
import { isoWeekKey } from './risk.util';

const M_PER_KM = 1000;

@Injectable()
export class RiskService {
  private readonly logger = new Logger(RiskService.name);

  constructor(
    private readonly flags: RiskFlagsService,
    private readonly ping: RiskPingService,
    private readonly handshake: RiskHandshakeService,
    private readonly settings: SettingsService,
    @InjectRepository(DeviceAccount)
    private readonly deviceAccounts: Repository<DeviceAccount>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
  ) {}

  private accuracyOk(evidence: LocationEvidence): boolean {
    const limit = this.settings.getNumber(
      SETTING_KEYS.RISK_EVIDENCE_MAX_ACCURACY_M,
      150,
    );
    return evidence.accuracy == null || evidence.accuracy <= limit;
  }

  /** A `last_known` fix can be minutes/km stale — never let it drive a distance rule. */
  private reliableForDistance(evidence: LocationEvidence): boolean {
    return evidence.source !== 'last_known' && this.accuracyOk(evidence);
  }

  private async raiseMockedIfNeeded(
    evidence: LocationEvidence,
    orderId: string,
  ): Promise<void> {
    if (!evidence.mocked) return;
    await this.flags.raise({
      rule: RiskRule.MockedLocation,
      severity: RiskSeverity.High,
      subjectType: RiskSubjectType.User,
      subjectId: evidence.actorUserId,
      orderId,
      summary:
        "GPS mock-app orqali soxtalashtirilgan bo'lishi mumkin (Android)",
      details: {
        orderId,
        source: evidence.source,
        latitude: evidence.latitude,
        longitude: evidence.longitude,
      },
      dedupeKey: `${RiskRule.MockedLocation}:${evidence.actorUserId}:${isoWeekKey(new Date())}`,
    });
  }

  // ---- Courier ping passthrough ----

  async recordCourierPing(input: {
    orderId: string;
    courierUserId: string;
    shopId: string | null;
    evidence: LocationEvidence;
  }): Promise<void> {
    await this.ping.recordPing(input);
  }

  // ---- Order lifecycle ----

  async onOrderDispatched(input: {
    orderId: string;
    shop: { latitude: number; longitude: number };
    evidence: LocationEvidence | null;
  }): Promise<void> {
    try {
      if (!input.evidence) return; // recorded-but-not-ruled: absence alone isn't punished here
      await this.raiseMockedIfNeeded(input.evidence, input.orderId);
      if (!this.reliableForDistance(input.evidence)) return;

      const distM =
        haversineKm(
          input.evidence.latitude,
          input.evidence.longitude,
          input.shop.latitude,
          input.shop.longitude,
        ) * M_PER_KM;
      const maxM = this.settings.getNumber(
        SETTING_KEYS.RISK_PICKUP_MAX_DISTANCE_M,
        400,
      );
      if (distM > maxM) {
        await this.flags.raise({
          rule: RiskRule.PickupFarFromShop,
          severity: RiskSeverity.Medium,
          subjectType: RiskSubjectType.User,
          subjectId: input.evidence.actorUserId,
          orderId: input.orderId,
          summary: `Kuryer do'kondan ~${Math.round(distM)}m uzoqda "Kuryerga berish"ni bosdi`,
          details: { distanceM: Math.round(distM), maxM },
          dedupeKey: `${RiskRule.PickupFarFromShop}:${input.orderId}`,
        });
      }
    } catch (err) {
      this.logger.error(
        `onOrderDispatched failed for order ${input.orderId}: ${(err as Error).message}`,
      );
    }
  }

  async onOrderDelivered(input: {
    orderId: string;
    deliveryAddress: { latitude: number; longitude: number } | null;
    /** Null = customer self-confirmed — never counted against a courier. */
    deliveredByUserId: string | null;
    evidence: LocationEvidence | null;
  }): Promise<void> {
    try {
      if (input.evidence) {
        await this.raiseMockedIfNeeded(input.evidence, input.orderId);
        if (this.reliableForDistance(input.evidence) && input.deliveryAddress) {
          const distM =
            haversineKm(
              input.evidence.latitude,
              input.evidence.longitude,
              input.deliveryAddress.latitude,
              input.deliveryAddress.longitude,
            ) * M_PER_KM;
          const maxM = this.settings.getNumber(
            SETTING_KEYS.RISK_DELIVERED_MAX_DISTANCE_M,
            300,
          );
          if (distM > maxM) {
            await this.flags.raise({
              rule: RiskRule.DeliveredFarFromAddress,
              severity: RiskSeverity.High,
              subjectType: RiskSubjectType.User,
              subjectId: input.evidence.actorUserId,
              orderId: input.orderId,
              summary: `"Yetkazildi" manzildan ~${Math.round(distM)}m uzoqda bosildi`,
              details: {
                distanceM: Math.round(distM),
                maxM,
                actorRole: input.evidence.actorRole,
              },
              dedupeKey: `${RiskRule.DeliveredFarFromAddress}:${input.orderId}`,
            });
          }
        }
      } else if (input.deliveredByUserId) {
        // Courier confirmed delivery with zero location evidence (permission
        // denied, GPS timeout, or the background task never reported).
        // Weekly-aggregated on purpose — Doze/battery-optimisation kills this
        // constantly on common UZ Android devices and per-event logging would
        // drown the admin queue with a device problem, not a fraud signal.
        await this.flags.raise({
          rule: RiskRule.DeliveredWithoutEvidence,
          severity: RiskSeverity.Low,
          subjectType: RiskSubjectType.User,
          subjectId: input.deliveredByUserId,
          orderId: input.orderId,
          summary: 'Kuryer joylashuv dalilisiz "Yetkazildi" bosdi',
          details: { orderId: input.orderId },
          dedupeKey: `${RiskRule.DeliveredWithoutEvidence}:${input.deliveredByUserId}:${isoWeekKey(new Date())}`,
        });
      }
    } catch (err) {
      this.logger.error(
        `onOrderDelivered failed for order ${input.orderId}: ${(err as Error).message}`,
      );
    }
  }

  // ---- Customer-signal correlation ----

  /** True if this order already carries a GPS-mismatch flag — used to escalate a complaint/low-rating into `corroborated_false_delivery`. */
  private async hasGpsMismatch(orderId: string): Promise<boolean> {
    const { total } = await this.flags.list({
      orderId,
      rule: RiskRule.DeliveredFarFromAddress,
      limit: 1,
    });
    return total > 0;
  }

  async onComplaintFiled(input: {
    orderId: string;
    courierUserId: string | null;
    /** Canned reason string from the app — see mobile's hardcoded complaint reasons. */
    reason: string;
  }): Promise<void> {
    try {
      if (!input.courierUserId) return;
      const isNotReceived = input.reason.includes('yetkazilmadi');
      if (!isNotReceived) return;

      await this.flags.raise({
        rule: RiskRule.NotReceivedComplaint,
        severity: RiskSeverity.High,
        subjectType: RiskSubjectType.User,
        subjectId: input.courierUserId,
        orderId: input.orderId,
        summary: 'Mijoz "mahsulot yetkazilmadi" deb shikoyat qildi',
        details: { orderId: input.orderId, reason: input.reason },
        dedupeKey: `${RiskRule.NotReceivedComplaint}:${input.orderId}`,
      });

      if (await this.hasGpsMismatch(input.orderId)) {
        await this.flags.raise({
          rule: RiskRule.CorroboratedFalseDelivery,
          severity: RiskSeverity.High,
          subjectType: RiskSubjectType.User,
          subjectId: input.courierUserId,
          orderId: input.orderId,
          summary:
            'Shikoyat VA GPS nomuvofiqligi bir buyurtmada — soxta yetkazish ehtimoli yuqori',
          details: { orderId: input.orderId, source: 'complaint' },
          dedupeKey: `${RiskRule.CorroboratedFalseDelivery}:${input.orderId}`,
        });
      }
    } catch (err) {
      this.logger.error(
        `onComplaintFiled failed for order ${input.orderId}: ${(err as Error).message}`,
      );
    }
  }

  async onCourierRated(input: {
    orderId: string;
    courierUserId: string;
    stars: number;
  }): Promise<void> {
    try {
      const threshold = this.settings.getNumber(
        SETTING_KEYS.RISK_LOW_RATING_THRESHOLD,
        2,
      );
      if (input.stars > threshold) return;

      await this.flags.raise({
        rule: RiskRule.LowCourierRating,
        severity: RiskSeverity.Medium,
        subjectType: RiskSubjectType.User,
        subjectId: input.courierUserId,
        orderId: input.orderId,
        summary: `Kuryer ${input.stars} yulduz bilan baholandi`,
        details: { orderId: input.orderId, stars: input.stars },
        dedupeKey: `${RiskRule.LowCourierRating}:${input.courierUserId}:${isoWeekKey(new Date())}`,
      });

      if (await this.hasGpsMismatch(input.orderId)) {
        await this.flags.raise({
          rule: RiskRule.CorroboratedFalseDelivery,
          severity: RiskSeverity.High,
          subjectType: RiskSubjectType.User,
          subjectId: input.courierUserId,
          orderId: input.orderId,
          summary:
            'Past baho VA GPS nomuvofiqligi bir buyurtmada — soxta yetkazish ehtimoli yuqori',
          details: {
            orderId: input.orderId,
            source: 'rating',
            stars: input.stars,
          },
          dedupeKey: `${RiskRule.CorroboratedFalseDelivery}:${input.orderId}`,
        });
      }
    } catch (err) {
      this.logger.error(
        `onCourierRated failed for order ${input.orderId}: ${(err as Error).message}`,
      );
    }
  }

  // ---- Pin evidence (addresses/shops) ----

  async onAddressPinned(input: {
    userId: string;
    addressId: string;
    pin: { latitude: number; longitude: number };
    evidence: LocationEvidence | null;
  }): Promise<void> {
    try {
      const maxM = this.settings.getNumber(
        SETTING_KEYS.RISK_ADDRESS_PIN_MAX_DISTANCE_M,
        0,
      );
      if (maxM <= 0) return; // shipped disabled — enable only after watching the real distribution
      if (!input.evidence || !this.reliableForDistance(input.evidence)) return;

      const distM =
        haversineKm(
          input.evidence.latitude,
          input.evidence.longitude,
          input.pin.latitude,
          input.pin.longitude,
        ) * M_PER_KM;
      if (distM > maxM) {
        await this.flags.raise({
          rule: RiskRule.AddressFarFromDevice,
          severity: RiskSeverity.Low,
          subjectType: RiskSubjectType.User,
          subjectId: input.userId,
          summary: `Saqlangan manzil qurilma GPSidan ~${Math.round(distM)}m uzoqda`,
          details: { addressId: input.addressId, distanceM: Math.round(distM) },
          dedupeKey: `${RiskRule.AddressFarFromDevice}:${input.userId}:${isoWeekKey(new Date())}`,
        });
      }
    } catch (err) {
      this.logger.error(
        `onAddressPinned failed for user ${input.userId}: ${(err as Error).message}`,
      );
    }
  }

  async onShopPinned(input: {
    shopId: string;
    hasDeliveredOrders: boolean;
    previous: { latitude: number; longitude: number } | null;
    next: { latitude: number; longitude: number };
  }): Promise<void> {
    try {
      if (!input.previous || !input.hasDeliveredOrders) return;
      const maxM = this.settings.getNumber(
        SETTING_KEYS.RISK_SHOP_RELOCATION_MAX_M,
        500,
      );
      const distM =
        haversineKm(
          input.previous.latitude,
          input.previous.longitude,
          input.next.latitude,
          input.next.longitude,
        ) * M_PER_KM;
      if (distM > maxM) {
        await this.flags.raise({
          rule: RiskRule.ShopRelocatedAfterOrders,
          severity: RiskSeverity.High,
          subjectType: RiskSubjectType.Shop,
          subjectId: input.shopId,
          shopId: input.shopId,
          summary: `Faol do'kon pinini ~${Math.round(distM)}m suridi`,
          details: {
            distanceM: Math.round(distM),
            previous: input.previous,
            next: input.next,
          },
          dedupeKey: `${RiskRule.ShopRelocatedAfterOrders}:${input.shopId}:${input.next.latitude.toFixed(4)},${input.next.longitude.toFixed(4)}`,
        });
      }
    } catch (err) {
      this.logger.error(
        `onShopPinned failed for shop ${input.shopId}: ${(err as Error).message}`,
      );
    }
  }

  // ---- Device identity ----

  async linkDevice(userId: string, deviceId: string | null): Promise<void> {
    if (!deviceId) return;
    try {
      await this.deviceAccounts.upsert(
        { deviceId, userId, lastSeenAt: new Date() },
        ['deviceId', 'userId'],
      );
      const count = await this.deviceAccounts.count({ where: { deviceId } });
      const maxAccounts = this.settings.getNumber(
        SETTING_KEYS.RISK_DEVICE_MAX_ACCOUNTS,
        5,
      );
      if (count > maxAccounts) {
        await this.flags.raise({
          rule: RiskRule.DeviceSharedAcrossAccounts,
          severity: RiskSeverity.Low,
          subjectType: RiskSubjectType.Device,
          subjectId: deviceId,
          deviceId,
          summary: `Bitta qurilmada ${count} ta akkaunt aniqlandi`,
          details: { accountCount: count },
          dedupeKey: `${RiskRule.DeviceSharedAcrossAccounts}:${deviceId}:${isoWeekKey(new Date())}`,
        });
      }
    } catch (err) {
      this.logger.error(
        `linkDevice failed for device ${deviceId}: ${(err as Error).message}`,
      );
    }
  }

  // ---- Admin surface passthrough ----

  list(opts: Parameters<RiskFlagsService['list']>[0]) {
    return this.flags.list(opts);
  }

  openCount(): Promise<number> {
    return this.flags.openCount();
  }

  review(
    id: string,
    status: RiskFlagStatus.Confirmed | RiskFlagStatus.Dismissed,
    adminUserId: string,
    note?: string,
  ) {
    return this.flags.review(id, status, adminUserId, note);
  }

  orderPings(orderId: string) {
    return this.ping.listForOrder(orderId);
  }

  orderPingSummary(orderId: string) {
    return this.ping.summaryForOrder(orderId);
  }

  // ---- QR handshake (narrow — only confirmed-flag couriers) ----

  requiresHandshake(courierUserId: string | null): Promise<boolean> {
    return this.handshake.requiresHandshake(courierUserId);
  }

  getOrIssueHandshakeToken(orderId: string): Promise<string> {
    return this.handshake.getOrIssueToken(orderId);
  }

  verifyHandshake(orderId: string, token: string): Promise<boolean> {
    return this.handshake.verify(orderId, token);
  }

  async wasHandshakeVerified(orderId: string): Promise<boolean> {
    return (await this.handshake.wasVerified(orderId)) > 0;
  }

  /** Admin-only: full evidence picture for one order — never exposed to the customer/shop apps. */
  async orderEvidence(orderId: string) {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) return null;
    const [pings, summary] = await Promise.all([
      this.ping.listForOrder(orderId),
      this.ping.summaryForOrder(orderId),
    ]);
    return {
      orderEvidence: order.orderEvidence,
      dispatchedEvidence: order.dispatchedEvidence,
      deliveredEvidence: order.deliveredEvidence,
      deliveryAddress: order.deliveryAddress,
      pings,
      summary,
    };
  }
}
