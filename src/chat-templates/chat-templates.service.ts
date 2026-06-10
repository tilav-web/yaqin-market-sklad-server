import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Or, Repository } from 'typeorm';

import { ChatTemplate } from './entities/chat-template.entity';

const SYSTEM_TEMPLATES = [
  "Buyurtmangizni qabul qildik, tez orada yo'lda bo'lamiz.",
  '10 daqiqada yetkazib beramiz.',
  '20 daqiqada yetkazib beramiz.',
  'Kechirasiz, ushbu mahsulot hozir tugagan.',
  "Yetkazib beruvchi yo'lda, tez yetib boradi.",
  'Buyurtmangiz yetkazildi. Xarid uchun rahmat!',
];

@Injectable()
export class ChatTemplatesService implements OnModuleInit {
  constructor(
    @InjectRepository(ChatTemplate)
    private readonly repo: Repository<ChatTemplate>,
  ) {}

  async onModuleInit() {
    for (let i = 0; i < SYSTEM_TEMPLATES.length; i++) {
      const text = SYSTEM_TEMPLATES[i];
      const exists = await this.repo.findOne({ where: { isSystem: true, text } });
      if (!exists) {
        await this.repo.save(this.repo.create({ shopId: null, text, isSystem: true, sortOrder: i }));
      }
    }
  }

  /** Seller uchun: tizim shablonlari + do'kon shablonlari birga. */
  async list(shopId: string): Promise<ChatTemplate[]> {
    return this.repo
      .createQueryBuilder('t')
      .where('t.shopId IS NULL OR t.shopId = :shopId', { shopId })
      .orderBy('t.isSystem', 'DESC')
      .addOrderBy('t.sortOrder', 'ASC')
      .addOrderBy('t.createdAt', 'ASC')
      .getMany();
  }

  async create(shopId: string, text: string): Promise<ChatTemplate> {
    const count = await this.repo.count({ where: { shopId, isSystem: false } });
    if (count >= 20) throw new BadRequestException('Maksimum 20 ta shaxsiy shablon');
    const last = await this.repo.findOne({
      where: { shopId },
      order: { sortOrder: 'DESC' },
    });
    const tmpl = this.repo.create({
      shopId,
      text: text.trim(),
      isSystem: false,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    });
    return this.repo.save(tmpl);
  }

  async update(shopId: string, id: string, text: string): Promise<ChatTemplate> {
    const tmpl = await this.findOwn(shopId, id);
    tmpl.text = text.trim();
    return this.repo.save(tmpl);
  }

  async remove(shopId: string, id: string): Promise<void> {
    const tmpl = await this.findOwn(shopId, id);
    await this.repo.remove(tmpl);
  }

  async reorder(shopId: string, ids: string[]): Promise<void> {
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
