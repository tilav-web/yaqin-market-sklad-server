import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PushService } from '../../push/push.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { ShopStaff } from '../../shops/entities/shop-staff.entity';
import { Shop } from '../../shops/entities/shop.entity';
import { ChatMessage } from '../entities/chat-message.entity';
import { Order, OrderStatus } from '../entities/order.entity';

@Injectable()
export class OrderChatService {
  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectRepository(ChatMessage)
    private readonly chat: Repository<ChatMessage>,
    @InjectRepository(ShopStaff)
    private readonly staff: Repository<ShopStaff>,
    private readonly realtime: RealtimeGateway,
    private readonly push: PushService,
  ) {}

  /** Verify the user is a party to the order and return { order, fromShop }. */
  private async authorizeChat(userId: string, orderId: string) {
    const order = await this.orders.findOne({
      where: { id: orderId },
      relations: { shop: true },
    });
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    const isCustomer = order.userId === userId;
    let isShop = order.shop.ownerId === userId;
    // Staff with the chat permission represent the shop side too.
    if (!isCustomer && !isShop) {
      const member = await this.staff.findOne({
        where: { shopId: order.shopId, userId, isActive: true },
      });
      if (!member?.permissions?.includes('orders.chat'))
        throw new ForbiddenException();
      isShop = true;
    }
    return { order, fromShop: isShop };
  }

  async listMessages(userId: string, orderId: string): Promise<ChatMessage[]> {
    await this.authorizeChat(userId, orderId);
    return this.chat.find({
      where: { orderId },
      order: { createdAt: 'ASC' },
      take: 200,
    });
  }

  async sendMessage(
    userId: string,
    orderId: string,
    text: string,
  ): Promise<ChatMessage> {
    const { order, fromShop } = await this.authorizeChat(userId, orderId);
    const message = await this.chat.save(
      this.chat.create({
        orderId,
        senderUserId: userId,
        fromShop,
        text: text.trim(),
      }),
    );
    // Deliver live to both parties.
    if (order.userId)
      this.realtime.emitToUser(order.userId, 'chat:message', message);
    this.realtime.emitToShop(order.shopId, 'chat:message', message);
    // Push the other party (excluding the sender).
    void this.notifyChat(order, fromShop, userId, text.trim());
    return message;
  }

  /** Push a new chat message to the receiving side (customer ↔ shop staff). */
  private async notifyChat(
    order: Pick<Order, 'id' | 'orderNumber' | 'userId' | 'shopId'> & {
      shop: Pick<Shop, 'ownerId'>;
    },
    fromShop: boolean,
    senderUserId: string,
    text: string,
  ): Promise<void> {
    const payload = {
      title: `#${order.orderNumber} — yangi xabar`,
      body: text.length > 80 ? `${text.slice(0, 80)}…` : text,
      data: { kind: 'chat', orderId: order.id, shopId: order.shopId },
    };
    if (fromShop) {
      // Shop → customer.
      if (order.userId) void this.push.sendToUser(order.userId, payload);
    } else {
      // Customer → shop owner + staff who can chat (minus the sender).
      const staff = await this.staff.find({
        where: { shopId: order.shopId, isActive: true },
      });
      const recipients = [
        order.shop.ownerId,
        ...staff
          .filter((s) => s.permissions?.includes('orders.chat'))
          .map((s) => s.userId),
      ].filter((id) => id && id !== senderUserId);
      void this.push.sendToUsers([...new Set(recipients)], payload);
    }
  }

  /** Formats user-friendly order status notification text. */
  formatStatusMessage(
    status: OrderStatus,
    orderNumber: string,
    note?: string,
  ): string | null {
    switch (status) {
      case OrderStatus.New:
        return `📦 Yangi buyurtma #${orderNumber} rasmiylashtirildi. Do'kon tez orada ko'rib chiqadi.`;
      case OrderStatus.Accepted:
        return `✅ Buyurtmangizni qabul qildik, tez orada yetkazamiz.`;
      case OrderStatus.Preparing:
        return `🧑‍🍳 Buyurtmangiz do'konda tayyorlanmoqda va qadoqlanmoqda.`;
      case OrderStatus.Delivering:
        return `🛵 Buyurtmangizni kuryerga berdik, u siz tomon ketmoqda, tez orada yetib boradi.`;
      case OrderStatus.Delivered:
        return `🎉 Buyurtma topshirildi. Bizni tanlaganingiz uchun rahmat! Xaridingiz yoqimli bo'lsin! 😊`;
      case OrderStatus.Cancelled:
        return note
          ? `❌ Buyurtma bekor qilindi. Sabab: ${note}`
          : `❌ Buyurtma bekor qilindi.`;
      case OrderStatus.SellerRejected:
        return note
          ? `⚠️ Do'kon buyurtmani qabul qila olmadi. Sabab: ${note}`
          : `⚠️ Do'kon buyurtmani qabul qila olmadi.`;
      case OrderStatus.SellerNoResponse:
        return `⌛ Do'kon belgilangan vaqt ichida javob bermadi va buyurtma bekor qilindi.`;
      default:
        return null;
    }
  }

  /** Automatically posts an order status system message into the chat. */
  async postStatusMessage(
    order: Pick<Order, 'id' | 'orderNumber' | 'userId' | 'shopId'> & {
      shop?: Pick<Shop, 'ownerId'>;
    },
    status: OrderStatus,
    note?: string,
  ): Promise<ChatMessage | null> {
    const text = this.formatStatusMessage(status, order.orderNumber, note);
    if (!text) return null;

    let shopOwnerId = order.shop?.ownerId;
    if (!shopOwnerId) {
      const dbOrder = await this.orders.findOne({
        where: { id: order.id },
        relations: { shop: true },
      });
      shopOwnerId = dbOrder?.shop?.ownerId;
    }

    const message = await this.chat.save(
      this.chat.create({
        orderId: order.id,
        senderUserId: shopOwnerId || order.userId,
        fromShop: true,
        text,
      }),
    );

    // Deliver live to customer and shop staff
    if (order.userId) {
      this.realtime.emitToUser(order.userId, 'chat:message', message);
    }
    this.realtime.emitToShop(order.shopId, 'chat:message', message);

    return message;
  }
}
