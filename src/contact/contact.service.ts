import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RedisService } from '../redis/redis.service';
import { CreateContactDto } from './dto/contact.dto';
import { ContactInquiry } from './entities/contact-inquiry.entity';

const RATE_LIMIT_PER_HOUR = 8;

@Injectable()
export class ContactService {
  constructor(
    @InjectRepository(ContactInquiry)
    private readonly inquiries: Repository<ContactInquiry>,
    private readonly redis: RedisService,
  ) {}

  /** Public submit, lightly rate-limited per IP to curb spam. */
  async create(dto: CreateContactDto, ip: string): Promise<{ ok: true }> {
    const key = `contact:ip:${ip}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) await this.redis.client.expire(key, 60 * 60);
    if (count > RATE_LIMIT_PER_HOUR) {
      throw new BadRequestException(
        "Juda ko'p murojaat. Birozdan keyin urinib ko'ring",
      );
    }
    const inquiry = this.inquiries.create({
      name: dto.name.trim(),
      phone: dto.phone.trim(),
      message: dto.message.trim(),
    });
    await this.inquiries.save(inquiry);
    return { ok: true };
  }

  list(): Promise<ContactInquiry[]> {
    return this.inquiries.find({ order: { createdAt: 'DESC' }, take: 500 });
  }

  async markRead(id: string): Promise<ContactInquiry | null> {
    await this.inquiries.update({ id }, { isRead: true });
    return this.inquiries.findOne({ where: { id } });
  }

  unreadCount(): Promise<number> {
    return this.inquiries.count({ where: { isRead: false } });
  }
}
