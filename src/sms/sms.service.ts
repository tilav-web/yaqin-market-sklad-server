import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EnvironmentVariables } from '../config/configuration';

interface EskizLoginResponse {
  message: string;
  data: { token: string };
  token_type: string;
}

interface EskizSendBody {
  mobile_phone: string;
  message: string;
  from: string;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    const text = `Yaqin Market: tasdiq kodi ${code}. Hech kimga aytmang.`;
    return this.send(phone, text);
  }

  async send(phone: string, message: string): Promise<void> {
    const email = this.config.get('ESKIZ_EMAIL', { infer: true });
    const password = this.config.get('ESKIZ_PASSWORD', { infer: true });
    const from = this.config.get('ESKIZ_FROM', { infer: true });
    const env = this.config.get('NODE_ENV', { infer: true });

    if (!email || !password) {
      this.logger.warn(`[DEV-SMS] to ${phone}: ${message}`);
      return;
    }

    if (env !== 'production') {
      this.logger.log(`[DEV-SMS-real] to ${phone}: ${message}`);
    }

    try {
      const token = await this.getToken(email, password);
      const body: EskizSendBody = {
        mobile_phone: phone.replace(/^\+/, ''),
        message,
        from,
      };

      const res = await fetch('https://notify.eskiz.uz/api/message/sms/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        this.logger.error(`Eskiz send failed: ${res.status} ${errText}`);
        throw new Error(`SMS send failed: ${res.status}`);
      }
    } catch (err) {
      this.logger.error('SMS provider error', err as Error);
      throw err;
    }
  }

  private async getToken(email: string, password: string): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }

    const res = await fetch('https://notify.eskiz.uz/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Eskiz auth failed: ${res.status} ${t}`);
    }

    const data = (await res.json()) as EskizLoginResponse;
    this.token = data.data.token;
    // Eskiz token typically valid for 30 days; refresh after 24h
    this.tokenExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
    return this.token;
  }
}
