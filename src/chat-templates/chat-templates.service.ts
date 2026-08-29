import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Or, Repository } from 'typeorm';

import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff } from '../shops/entities/shop-staff.entity';
import { assertShopPermission } from '../shops/shop-access.util';
import { ChatTemplate } from './entities/chat-template.entity';
import { toLocalizedText } from '../common/types/localized-text.type';

const SYSTEM_TEMPLATES = [
  "Assalomu alaykum! Buyurtmangiz qabul qilindi, tayyorlayapmiz.",
  "Kechirasiz, buyurtmangizdagi ayrim mahsulotlar qolmagan. O'rniga boshqasini taklif qilsak bo'ladimi?",
  "Buyurtmangiz yig'ildi va kuryerga topshirildi.",
  "Rahmat! Xaridingiz uchun minnatdormiz. Yana kutib qolamiz!",
];

@Injectable()
export class ChatTemplatesService implements OnModuleInit {
  constructor(
    @InjectRepository(ChatTemplate)
    private readonly repo: Repository<ChatTemplate>,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
    @InjectRepository(ShopStaff)
    private readonly staff: Repository<ShopStaff>,
  ) {}

  async onModuleInit() {
    for (let i = 0; i < SYSTEM_TEMPLATES.length; i++) {
      const rawText = SYSTEM_TEMPLATES[i];
      const exists = await this.repo.findOne({ where: { isSystem: true, sortOrder: i } });
      if (!exists) {
        await this.repo.save(this.repo.create({ shopId: null, text: toLocalizedText(rawText), isSystem: true, sortOrder: i }));
      }
    }
  }

  /** Owner always passes; staff need the chat permission (same one that gates order chat). */
  private ensureAccess(userId: string, shopId: string) {
    return assertShopPermission(this.shops, this.staff, userId, shopId, 'orders.chat');
  }

  /** Seller uchun: tizim shablonlari + do'kon shablonlari birga. */
  async list(userId: string, shopId: string): Promise<ChatTemplate[]> {
    await this.ensureAccess(userId, shopId);
    return this.repo
      .createQueryBuilder('t')
      .where('t.shopId IS NULL OR t.shopId = :shopId', { shopId })
      .orderBy('t.isSystem', 'DESC')
      .addOrderBy('t.sortOrder', 'ASC')
      .addOrderBy('t.createdAt', 'ASC')
      .getMany();
  }

  async create(userId: string, shopId: string, text: string): Promise<ChatTemplate> {
    await this.ensureAccess(userId, shopId);
    const count = await this.repo.count({ where: { shopId, isSystem: false } });
    if (count >= 20) throw new BadRequestException('Maksimum 20 ta shaxsiy shablon');
    const last = await this.repo.findOne({
      where: { shopId },
      order: { sortOrder: 'DESC' },
    });
    const tmpl = this.repo.create({
      shopId,
      text: toLocalizedText(text),
      isSystem: false,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    });
    return this.repo.save(tmpl);
  }

  async update(userId: string, shopId: string, id: string, text: string): Promise<ChatTemplate> {
    await this.ensureAccess(userId, shopId);
    const tmpl = await this.findOwn(shopId, id);
    tmpl.text = toLocalizedText(text);
    return this.repo.save(tmpl);
  }

  async remove(userId: string, shopId: string, id: string): Promise<void> {
    await this.ensureAccess(userId, shopId);
    const tmpl = await this.findOwn(shopId, id);
    await this.repo.remove(tmpl);
  }

  async reorder(userId: string, shopId: string, ids: string[]): Promise<void> {
    await this.ensureAccess(userId, shopId);
    for (let i = 0; i < ids.length; i++) {
      await this.repo.update({ id: ids[i], shopId }, { sortOrder: i });
    }
  }

  private async findOwn(shopId: string, id: string): Promise<ChatTemplate> {
    const tmpl = await this.repo.findOne({ where: { id } });
    if (!tmpl) throw new NotFoundException('Shablon topilmadi');
    if (tmpl.isSystem) throw new ForbiddenException('Tizim shablonini o\'zgartirish mumkin emas');
    if (tmpl.shopId !== shopId) throw new ForbiddenException('Ruxsat yo\'q');
    return tmpl;
  }
}
