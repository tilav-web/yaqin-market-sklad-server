import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { Order, PaymentMethod, PaymentStatus, isTerminalOrderStatus } from '../orders/entities/order.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AddCardDto } from './dto/add-card.dto';
import { VerifyCardDto } from './dto/verify-card.dto';
import { ClickDeclinedException, ClickMerchantService } from './click-merchant.service';
import { ClickPaymentTransaction, ClickTxStatus } from './click-payment-transaction.entity';
import { SavedCard, SavedCardStatus } from './saved-card.entity';

/** A user can't hoard unlimited card tokens — this is a cheap abuse guard, not a product limit. */
const MAX_CARDS_PER_USER = 5;

export interface PublicSavedCard {
  id: string;
  cardNumberMasked: string | null;
  label: string | null;
  isDefault: boolean;
  status: SavedCardStatus;
}

@Injectable()
export class ClickCardService {
  constructor(
    @InjectRepository(SavedCard)
    private readonly cardRepo: Repository<SavedCard>,
    @InjectRepository(ClickPaymentTransaction)
    private readonly txRepo: Repository<ClickPaymentTransaction>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    private readonly dataSource: DataSource,
    private readonly merchant: ClickMerchantService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async listCards(userId: string): Promise<PublicSavedCard[]> {
    const cards = await this.cardRepo.find({
      where: { userId, status: SavedCardStatus.Active },
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });
    return cards.map(this.toPublic);
  }

  /** Step 1: sends card_number+expire_date to Click, which SMSes a code to the card's phone. */
  async addCard(userId: string, dto: AddCardDto): Promise<{ cardId: string; phoneNumber: string | null }> {
    const activeCount = await this.cardRepo.count({ where: { userId, status: SavedCardStatus.Active } });
    if (activeCount >= MAX_CARDS_PER_USER) {
      throw new BadRequestException(`Bir foydalanuvchi uchun eng ko'pi bilan ${MAX_CARDS_PER_USER} ta karta saqlanishi mumkin`);
    }

    const { cardToken, phoneNumber } = await this.merchant.requestToken(dto.card_number, dto.expire_date);

    const card = await this.cardRepo.save(
      this.cardRepo.create({
        userId,
        cardToken,
        phoneNumber,
        label: dto.label?.trim() || null,
        status: SavedCardStatus.PendingVerify,
      }),
    );
    return { cardId: card.id, phoneNumber };
  }

  /** Step 2: confirms the SMS code, activating the card for payments. */
  async verifyCard(userId: string, cardId: string, dto: VerifyCardDto): Promise<PublicSavedCard> {
    const card = await this.cardRepo.findOne({
      where: { id: cardId, userId, status: SavedCardStatus.PendingVerify },
    });
    if (!card) throw new NotFoundException("Tasdiqlanishi kutilayotgan karta topilmadi");

    const { cardNumberMasked } = await this.merchant.verifyToken(card.cardToken, dto.sms_code);

    // Same physical card already saved — Click doesn't dedupe card_token
    // requests for us, so without this a user could burn multiple of their
    // MAX_CARDS_PER_USER slots re-adding the same PAN.
    if (cardNumberMasked) {
      const duplicate = await this.cardRepo.findOne({
        where: { userId, status: SavedCardStatus.Active, cardNumberMasked },
      });
      if (duplicate) {
        await this.merchant.deleteToken(card.cardToken);
        await this.cardRepo.delete({ id: card.id });
        throw new BadRequestException('Bu karta allaqachon saqlangan');
      }
    }

    card.status = SavedCardStatus.Active;
    card.cardNumberMasked = cardNumberMasked;
    // First verified card becomes the default automatically.
    const hasOtherActive = await this.cardRepo.count({ where: { userId, status: SavedCardStatus.Active } });
    if (hasOtherActive === 0) card.isDefault = true;

    const saved = await this.cardRepo.save(card);
    return this.toPublic(saved);
  }

  /** Switches which saved card pre-fills as the checkout default. */
  async setDefaultCard(userId: string, cardId: string): Promise<PublicSavedCard> {
    const card = await this.cardRepo.findOne({
      where: { id: cardId, userId, status: SavedCardStatus.Active },
    });
    if (!card) throw new NotFoundException('Karta topilmadi');

    await this.cardRepo.update({ userId }, { isDefault: false });
    card.isDefault = true;
    const saved = await this.cardRepo.save(card);
    return this.toPublic(saved);
  }

  async deleteCard(userId: string, cardId: string): Promise<void> {
    const card = await this.cardRepo.findOne({ where: { id: cardId, userId } });
    if (!card) throw new NotFoundException('Karta topilmadi');
    await this.merchant.deleteToken(card.cardToken);
    await this.cardRepo.delete({ id: card.id });
  }

  /** Charges a saved card directly — no my.click.uz redirect. */
  async payOrderWithCard(userId: string, orderId: string, cardId: string): Promise<{ orderId: string; paymentId: string }> {
    const order = await this.orderRepo.findOne({ where: { id: orderId, userId } });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (order.paymentMethod !== PaymentMethod.ClickOnline) {
      throw new BadRequestException("Bu buyurtma uchun online to'lov yoqilmagan");
    }
    if (order.paymentStatus === PaymentStatus.Paid) {
      throw new BadRequestException("Buyurtma allaqachon to'langan");
    }
    if (isTerminalOrderStatus(order.status)) {
      throw new BadRequestException("Bekor qilingan buyurtma uchun to'lov qilib bo'lmaydi");
    }

    const card = await this.cardRepo.findOne({ where: { id: cardId, userId, status: SavedCardStatus.Active } });
    if (!card) throw new NotFoundException('Karta topilmadi');

    // Reserve the transaction row before calling out to Click, mirroring
    // ClickService.prepare()'s race-safe insert-or-reuse pattern, so two
    // concurrent taps on "pay with this card" can't both charge it.
    const reserved = await this.dataSource.transaction(async (em) => {
      let tx = await em.findOne(ClickPaymentTransaction, {
        where: { orderId: order.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (tx?.status === ClickTxStatus.Success) return null;
      if (!tx) {
        tx = em.create(ClickPaymentTransaction, {
          orderId: order.id,
          amount: String(order.total),
          status: ClickTxStatus.Pending,
        });
      }
      try {
        return await em.save(ClickPaymentTransaction, tx);
      } catch (e: any) {
        if (e?.code === '23505') {
          const winner = await em.findOne(ClickPaymentTransaction, {
            where: { orderId: order.id },
            lock: { mode: 'pessimistic_write' },
          });
          if (!winner) throw e;
          return winner.status === ClickTxStatus.Success ? null : winner;
        }
        throw e;
      }
    });

    if (!reserved) throw new BadRequestException("Buyurtma allaqachon to'langan");

    let paymentId: string;
    try {
      const result = await this.merchant.payWithToken(card.cardToken, order.total, order.id);
      paymentId = result.paymentId;
    } catch (err) {
      const errorCode = err instanceof ClickDeclinedException ? err.errorCode : null;
      const errorNote = err instanceof ClickDeclinedException ? err.errorNote : (err as Error)?.message ?? null;
      await this.txRepo.update({ orderId: order.id }, { status: ClickTxStatus.Cancelled, errorCode, errorNote });
      await this.orderRepo.update(order.id, { paymentStatus: PaymentStatus.Failed });
      throw err;
    }

    await this.txRepo.update({ orderId: order.id }, { status: ClickTxStatus.Success, clickPaymentId: paymentId });
    await this.orderRepo.update(order.id, { paymentStatus: PaymentStatus.Paid });

    if (order.userId) this.realtime.emitToUser(order.userId, 'order:payment_confirmed', { orderId: order.id });

    return { orderId: order.id, paymentId };
  }

  private toPublic(card: SavedCard): PublicSavedCard {
    return {
      id: card.id,
      cardNumberMasked: card.cardNumberMasked,
      label: card.label,
      isDefault: card.isDefault,
      status: card.status,
    };
  }
}
