import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { GlobalSetting, SETTING_KEYS } from './entities/global-setting.entity';

const DEFAULTS: Record<string, { value: string; description: string }> = {
  [SETTING_KEYS.COMMISSION_RATE_DEFAULT]: { value: '12.00', description: 'Standart komissiya foizi (%)' },
  [SETTING_KEYS.DEBT_DUE_DAYS]: { value: '30', description: 'Qarz to\'lash muddati (kun)' },
  [SETTING_KEYS.SETTLEMENT_HOURS]: { value: '24', description: 'Pul yetkazilgandan necha soat keyin chiqariladi' },
};

@Injectable()
export class SettingsService implements OnModuleInit {
  private cache = new Map<string, string>();

  constructor(
    @InjectRepository(GlobalSetting)
    private readonly repo: Repository<GlobalSetting>,
  ) {}

  async onModuleInit() {
    // Seed defaults if missing
    for (const [key, { value, description }] of Object.entries(DEFAULTS)) {
      const existing = await this.repo.findOne({ where: { key } });
      if (!existing) {
        await this.repo.save(this.repo.create({ key, value, description }));
      }
    }
    await this.refreshCache();
  }

  private async refreshCache() {
    const all = await this.repo.find();
    this.cache.clear();
    all.forEach(s => this.cache.set(s.key, s.value));
  }

  get(key: string, fallback = ''): string {
    return this.cache.get(key) ?? DEFAULTS[key]?.value ?? fallback;
  }

  getNumber(key: string, fallback = 0): number {
    const v = this.get(key);
    const n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  }

  async getAll(): Promise<GlobalSetting[]> {
    return this.repo.find({ order: { key: 'ASC' } });
  }

  async set(key: string, value: string): Promise<GlobalSetting> {
    let setting = await this.repo.findOne({ where: { key } });
    if (!setting) {
      setting = this.repo.create({ key, value, description: null });
    } else {
      setting.value = value;
    }
    const saved = await this.repo.save(setting);
    this.cache.set(key, value);
    return saved;
  }
}
