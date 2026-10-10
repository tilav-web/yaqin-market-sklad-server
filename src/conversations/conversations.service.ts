import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PushService } from '../push/push.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { Shop } from '../shops/entities/shop.entity';
import {
  computePermissionsForRoles,
  ShopStaff,
} from '../shops/entities/shop-staff.entity';
import { User } from '../users/entities/user.entity';
import { SendConversationMessageDto } from './dto/send-conversation-message.dto';
import { Conversation } from './entities/conversation.entity';
import { ConversationMessage } from './entities/conversation-message.entity';

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
    @InjectRepository(ConversationMessage)
    private readonly messages: Repository<ConversationMessage>,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    @InjectRepository(ShopStaff)
    private readonly staff: Repository<ShopStaff>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly realtime: RealtimeGateway,
    private readonly push: PushService,
  ) {}

  /**
   * List all conversations for the user:
   * 1. Buyer conversations where customerId = userId
   * 2. If user is owner or active staff of any shop, also include shop conversations.
   */
  async listUserConversations(userId: string): Promise<any[]> {
    // Check if user owns or works at any shops
    const ownedShops = await this.shops.find({
      where: { ownerId: userId },
      select: { id: true },
    });
    const staffMemberships = await this.staff.find({
      where: { userId, isActive: true },
    });
    const chatStaffShopIds = staffMemberships
      .filter((m) =>
        computePermissionsForRoles(m.roles || [], m.permissions || []).includes(
          'orders.chat',
        ),
      )
      .map((s) => s.shopId);
    const sellerShopIds = [...ownedShops.map((s) => s.id), ...chatStaffShopIds];

    const qb = this.conversations
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.shop', 'shop')
      .leftJoinAndSelect('c.customer', 'customer')
      .where('c.customerId = :userId', { userId });

    if (sellerShopIds.length > 0) {
      qb.orWhere('c.shopId IN (:...sellerShopIds)', { sellerShopIds });
    }

    qb.orderBy('c.lastMessageAt', 'DESC', 'NULLS LAST').addOrderBy(
      'c.createdAt',
      'DESC',
    );

    const list = await qb.getMany();

    return list.map((c) => {
      const isSellerSide = sellerShopIds.includes(c.shopId);
      return {
        id: c.id,
        shopId: c.shopId,
        shopName: c.shop?.name ?? '',
        shopPhotos: c.shop?.photos ?? [],
        customerId: c.customerId,
        customerName:
          c.customer?.name ||
          [c.customer?.firstName, c.customer?.lastName]
            .filter(Boolean)
            .join(' ') ||
          'Foydalanuvchi',
        customerPhone: c.customer?.phone ?? '',
        customerAvatarUrl: c.customer?.avatarUrl ?? null,
        lastMessageText: c.lastMessageText,
        lastMessageAt: c.lastMessageAt,
        unreadCount: isSellerSide ? c.unreadCountShop : c.unreadCountCustomer,
        isSellerSide,
        createdAt: c.createdAt,
      };
    });
  }

  /**
   * Get existing conversation or create a new one between the customer and shop.
   */
  async getOrCreateWithShop(userId: string, shopId: string): Promise<any> {
    const shop = await this.shops.findOne({
      where: { id: shopId },
      select: { id: true, name: true, photos: true, ownerId: true },
    });
    if (!shop) {
      throw new NotFoundException("Do'kon topilmadi");
    }

    let conv = await this.conversations.findOne({
      where: { shopId, customerId: userId },
      relations: { shop: true, customer: true },
    });

    if (!conv) {
      conv = await this.conversations.save(
        this.conversations.create({
          shopId,
          customerId: userId,
          unreadCountCustomer: 0,
          unreadCountShop: 0,
        }),
      );
      conv = (await this.conversations.findOne({
        where: { id: conv.id },
        relations: { shop: true, customer: true },
      }))!;
    }

    return {
      id: conv.id,
      shopId: conv.shopId,
      shopName: conv.shop?.name ?? '',
      shopPhotos: conv.shop?.photos ?? [],
      customerId: conv.customerId,
      customerName:
        conv.customer?.name ||
        [conv.customer?.firstName, conv.customer?.lastName]
          .filter(Boolean)
          .join(' ') ||
        'Foydalanuvchi',
      lastMessageText: conv.lastMessageText,
      lastMessageAt: conv.lastMessageAt,
      unreadCount: conv.unreadCountCustomer,
      createdAt: conv.createdAt,
    };
  }

  /**
   * Verify participant and determine sender role.
   */
  async authorize(
    userId: string,
    conversationId: string,
  ): Promise<{ conversation: Conversation; fromShop: boolean }> {
    const conversation = await this.conversations.findOne({
      where: { id: conversationId },
      relations: { shop: true, customer: true },
    });
    if (!conversation) {
      throw new NotFoundException('Suhbat topilmadi');
    }

    if (conversation.customerId === userId) {
      return { conversation, fromShop: false };
    }

    if (conversation.shop.ownerId === userId) {
      return { conversation, fromShop: true };
    }

    const staffMember = await this.staff.findOne({
      where: { shopId: conversation.shopId, userId, isActive: true },
    });
    if (staffMember) {
      return { conversation, fromShop: true };
    }

    throw new ForbiddenException("Sizda ushbu suhbatga kirish huquqi yo'q");
  }

  async listMessages(
    userId: string,
    conversationId: string,
  ): Promise<ConversationMessage[]> {
    await this.authorize(userId, conversationId);
    return this.messages.find({
      where: { conversationId },
      relations: { sender: true },
      order: { createdAt: 'ASC' },
      take: 200,
    });
  }

  async sendMessage(
    userId: string,
    conversationId: string,
    dto: SendConversationMessageDto,
  ): Promise<ConversationMessage> {
    const { conversation, fromShop } = await this.authorize(
      userId,
      conversationId,
    );

    const message = await this.messages.save(
      this.messages.create({
        conversationId,
        senderUserId: userId,
        fromShop,
        text: dto.text.trim(),
        attachedProductId: dto.attachedProductId,
        attachedOrderNumber: dto.attachedOrderNumber,
        photoUrl: dto.photoUrl,
        isRead: false,
      }),
    );

    // Update conversation summary
    conversation.lastMessageText = dto.text.trim();
    conversation.lastMessageAt = message.createdAt;
    if (fromShop) {
      conversation.unreadCountCustomer =
        (conversation.unreadCountCustomer || 0) + 1;
    } else {
      conversation.unreadCountShop = (conversation.unreadCountShop || 0) + 1;
    }
    await this.conversations.save(conversation);

    // Live socket emission to customer and shop room
    this.realtime.emitToUser(
      conversation.customerId,
      'conversation:message',
      message,
    );
    this.realtime.emitToShop(
      conversation.shopId,
      'conversation:message',
      message,
    );

    // Push notification delivery
    void this.notifyParticipants(
      conversation,
      fromShop,
      userId,
      dto.text.trim(),
    );

    return message;
  }

  async markAsRead(userId: string, conversationId: string): Promise<void> {
    const { conversation, fromShop } = await this.authorize(
      userId,
      conversationId,
    );

    if (fromShop) {
      conversation.unreadCountShop = 0;
    } else {
      conversation.unreadCountCustomer = 0;
    }
    await this.conversations.save(conversation);

    await this.messages.update(
      {
        conversationId,
        fromShop: !fromShop,
        isRead: false,
      },
      { isRead: true },
    );

    const readPayload = {
      conversationId,
      readByUserId: userId,
      fromShop,
      readAt: new Date().toISOString(),
    };
    this.realtime.emitToUser(
      conversation.customerId,
      'conversation:read',
      readPayload,
    );
    this.realtime.emitToShop(
      conversation.shopId,
      'conversation:read',
      readPayload,
    );
  }

  private async notifyParticipants(
    conversation: Conversation,
    fromShop: boolean,
    senderUserId: string,
    text: string,
  ): Promise<void> {
    try {
      if (fromShop) {
        // Shop -> Customer
        const payload = {
          title: conversation.shop.name,
          body: text.length > 80 ? `${text.slice(0, 80)}…` : text,
          data: {
            kind: 'conversation',
            conversationId: conversation.id,
            shopId: conversation.shopId,
          },
        };
        await this.push.sendToUser(conversation.customerId, payload);
      } else {
        // Customer -> Shop owner & staff
        const customerName =
          conversation.customer.name ||
          [conversation.customer.firstName, conversation.customer.lastName]
            .filter(Boolean)
            .join(' ') ||
          'Xaridor';
        const payload = {
          title: `${customerName} — yangi xabar`,
          body: text.length > 80 ? `${text.slice(0, 80)}…` : text,
          data: {
            kind: 'conversation',
            conversationId: conversation.id,
            shopId: conversation.shopId,
          },
        };

        const staffMembers = await this.staff.find({
          where: { shopId: conversation.shopId, isActive: true },
        });
        const chatStaffMembers = staffMembers.filter((m) =>
          computePermissionsForRoles(
            m.roles || [],
            m.permissions || [],
          ).includes('orders.chat'),
        );
        const recipients = [
          conversation.shop.ownerId,
          ...chatStaffMembers.map((s) => s.userId),
        ].filter((id) => id && id !== senderUserId);

        await this.push.sendToUsers([...new Set(recipients)], payload);
      }
    } catch {
      // Push error shouldn't fail messaging
    }
  }
}
