import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
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
    user = this.users.create({
      phone,
      lastLoginAt: new Date(),
    });
    return this.users.save(user);
  }
}
