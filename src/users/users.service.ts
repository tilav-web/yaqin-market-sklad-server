import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UserAddress } from './entities/user-address.entity';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(UserAddress)
    private readonly addresses: Repository<UserAddress>,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  findByPhone(phone: string): Promise<User | null> {
    return this.users.findOne({ where: { phone } });
  }

  async upsertByPhone(phone: string): Promise<User> {
    let user = await this.findByPhone(phone);
    if (user) {
      user.lastLoginAt = new Date();
      return this.users.save(user);
    }
    user = this.users.create({ phone, lastLoginAt: new Date() });
    return this.users.save(user);
  }

  async updateProfile(userId: string, dto: { name?: string; avatarUrl?: string }): Promise<User> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('Foydalanuvchi topilmadi');
    if (dto.name !== undefined) user.name = dto.name;
    if (dto.avatarUrl !== undefined) user.avatarUrl = dto.avatarUrl;
    return this.users.save(user);
  }

  // Addresses
  listAddresses(userId: string): Promise<UserAddress[]> {
    return this.addresses.find({ where: { userId }, order: { isDefault: 'DESC', createdAt: 'ASC' } });
  }

  async createAddress(
    userId: string,
    dto: {
      label: string;
      address: string;
      latitude: number;
      longitude: number;
      notes?: string;
      isDefault?: boolean;
    },
  ): Promise<UserAddress> {
    if (dto.isDefault) {
      await this.addresses.update({ userId }, { isDefault: false });
    }
    const existing = await this.addresses.count({ where: { userId } });
    const address = this.addresses.create({
      userId,
      label: dto.label,
      address: dto.address,
      latitude: dto.latitude,
      longitude: dto.longitude,
      notes: dto.notes ?? null,
      isDefault: dto.isDefault ?? existing === 0,
    });
    return this.addresses.save(address);
  }

  async updateAddress(
    userId: string,
    addressId: string,
    dto: Partial<{
      label: string;
      address: string;
      latitude: number;
      longitude: number;
      notes: string;
      isDefault: boolean;
    }>,
  ): Promise<UserAddress> {
    const address = await this.addresses.findOne({ where: { id: addressId, userId } });
    if (!address) throw new NotFoundException('Manzil topilmadi');
    if (dto.isDefault) {
      await this.addresses.update({ userId }, { isDefault: false });
    }
    Object.assign(address, dto);
    return this.addresses.save(address);
  }

  async deleteAddress(userId: string, addressId: string): Promise<void> {
    const result = await this.addresses.delete({ id: addressId, userId });
    if (!result.affected) throw new NotFoundException('Manzil topilmadi');
  }
}
