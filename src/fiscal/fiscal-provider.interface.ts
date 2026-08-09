import { Logger } from '@nestjs/common';

import { FiscalReceipt } from './entities/fiscal-receipt.entity';

/** OFD provayderi qaytaradigan fiskal rekvizitlar. */
export interface FiscalDispatchResult {
  fiscalSign: string;
  fiscalReceiptNumber: string;
  terminalId: string | null;
  qrUrl: string | null;
}

/**
 * DI token — `fiscal.module.ts`da `{ provide: FISCAL_PROVIDER, useClass: ... }`
 * bilan ulanadi. Real OFD/vendor provayder tayyor bo'lganda shu bitta qatorni
 * o'zgartirish kifoya — `FiscalService`ning o'zi (yoki uni ulaydigan boshqa
 * kod) tegilmaydi. Oldin bu `fiscal.service.ts`da qattiq kodlangan edi
 * (`new NoopFiscalProvider()` field-initializer) — bu FISKAL_SOLIQ_REFERENCE.md
 * auditida topilgan kamchilik edi.
 */
export const FISCAL_PROVIDER = Symbol('FISCAL_PROVIDER');

/**
 * OFD (fiskal ma'lumotlar operatori) abstraksiyasi.
 *
 * Hozircha real shartnoma yo'q — NoopFiscalProvider ishlaydi va live rejimda
 * chekni yubormasdan xato qaytaradi. OFD tanlangach (o'z virtual kassa yoki
 * tayyor provayder) shu interfeys ustida bitta klass yoziladi, `fiscal.module.ts`
 * dagi `FISCAL_PROVIDER` provideri o'sha klassga ko'rsatiladi — boshqa kod
 * o'zgarmaydi.
 */
export interface FiscalProvider {
  readonly name: string;
  /** Sotuv yoki qaytarish chekini OFDga yuboradi. Xatoda throw qiladi. */
  dispatch(receipt: FiscalReceipt): Promise<FiscalDispatchResult>;
}

export class NoopFiscalProvider implements FiscalProvider {
  readonly name = 'none';
  private readonly logger = new Logger(NoopFiscalProvider.name);

  dispatch(receipt: FiscalReceipt): Promise<FiscalDispatchResult> {
    this.logger.warn(
      `fiscal_mode=live, lekin OFD provayder sozlanmagan — chek ${receipt.id} yuborilmadi`,
    );
    return Promise.reject(
      new Error('OFD provayder sozlanmagan (provider=none)'),
    );
  }
}
