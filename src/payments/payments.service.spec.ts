import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { ComplaintsService } from '../complaints/complaints.service';
import { PushService } from '../push/push.service';
import { SETTING_KEYS } from '../settings/entities/global-setting.entity';
import { SettingsService } from '../settings/settings.service';
import { Shop } from '../shops/entities/shop.entity';
import { SellerBalance } from './entities/seller-balance.entity';
import { SellerTransaction, SellerTxType } from './entities/seller-transaction.entity';
import { WithdrawalRequest, WithdrawalStatus } from './entities/withdrawal-request.entity';
import { PaymentsService } from './payments.service';

/** A SellerBalance row as it'd come back from the DB (all money fields are strings). */
function makeBalance(overrides: Partial<SellerBalance> = {}): SellerBalance {
  return {
    id: 'balance-1',
    sellerId: 'seller-1',
    pendingBalance: '0',
    availableBalance: '0',
    debtBalance: '0',
    debtDueDate: null,
    lastDebtReminderAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * A stand-in EntityManager for `dataSource.transaction(cb)` callbacks.
 * `findOne(SellerBalance, ...)` is backed by a sellerId→balance map so
 * mutations made inside one transaction are visible to the next (mirrors a
 * real DB row being read/written by reference within a test).
 */
function pendingTx(overrides: Partial<SellerTransaction> = {}): SellerTransaction {
  return {
    id: 'tx-1',
    sellerId: 'seller-1',
    orderId: 'order-1',
    type: SellerTxType.OnlineOrderPending,
    amount: '1000',
    commissionRate: null,
    commissionAmount: null,
    status: 'pending',
    settlesAt: new Date(Date.now() - 1000),
    description: '',
    createdAt: new Date(),
    ...overrides,
  };
}

function mockEntityManager(
  balances: Record<string, SellerBalance>,
  txById: Record<string, SellerTransaction> = {},
  withdrawalById: Record<string, WithdrawalRequest> = {},
) {
  return {
    findOne: jest.fn(async (Entity: unknown, opts: { where: { sellerId?: string; id?: string } }) => {
      if (Entity === SellerBalance) {
        const sellerId = opts.where.sellerId as string;
        return balances[sellerId] ?? null;
      }
      if (Entity === SellerTransaction) {
        return txById[opts.where.id as string] ?? null;
      }
      if (Entity === WithdrawalRequest) {
        return withdrawalById[opts.where.id as string] ?? null;
      }
      return null;
    }),
    create: jest.fn((_Entity: unknown, data: unknown) => ({ ...(data as object) })),
    save: jest.fn(async (_Entity: unknown, data: unknown) => data),
    update: jest.fn(),
  };
}

describe('PaymentsService', () => {
  let service: PaymentsService;
  let balances: jest.Mocked<Repository<SellerBalance>>;
  let txs: jest.Mocked<Repository<SellerTransaction>>;
  let withdrawals: jest.Mocked<Repository<WithdrawalRequest>>;
  let shops: jest.Mocked<Repository<Shop>>;
  let settings: { getNumber: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let push: { sendToUser: jest.Mock };
  let complaints: { openComplaintOrderIds: jest.Mock };

  const buildRepoMock = () => ({
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn((data: unknown) => data),
    update: jest.fn(),
    findOneOrFail: jest.fn(),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    })),
  });

  beforeEach(async () => {
    settings = { getNumber: jest.fn().mockReturnValue(30) };
    dataSource = { transaction: jest.fn() };
    push = { sendToUser: jest.fn() };
    complaints = { openComplaintOrderIds: jest.fn().mockResolvedValue(new Set()) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(SellerBalance), useFactory: buildRepoMock },
        { provide: getRepositoryToken(SellerTransaction), useFactory: buildRepoMock },
        { provide: getRepositoryToken(WithdrawalRequest), useFactory: buildRepoMock },
        { provide: getRepositoryToken(Shop), useFactory: buildRepoMock },
        { provide: SettingsService, useValue: settings },
        { provide: DataSource, useValue: dataSource },
        { provide: PushService, useValue: push },
        { provide: ComplaintsService, useValue: complaints },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    balances = module.get(getRepositoryToken(SellerBalance));
    txs = module.get(getRepositoryToken(SellerTransaction));
    withdrawals = module.get(getRepositoryToken(WithdrawalRequest));
    shops = module.get(getRepositoryToken(Shop));
  });

  afterEach(() => jest.clearAllMocks());

  describe('requestWithdrawal — amount validation', () => {
    it.each([NaN, -1, 0, Infinity, -Infinity])('yaroqsiz miqdor (%p) uchun rad etadi', async (amount) => {
      await expect(
        service.requestWithdrawal('seller-1', { amount, bankCardNumber: '8600...', bankCardHolderName: 'A B' }),
      ).rejects.toThrow(BadRequestException);
      // Must reject before ever opening a transaction.
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('requestWithdrawal — debt-first repayment', () => {
    it('qarz so\'ralgan summadan kichik: qarz to\'liq so\'ndiriladi, qolgani chiqariladi', async () => {
      const bal = makeBalance({ sellerId: 'seller-1', availableBalance: '100000', debtBalance: '30000' });
      const em = mockEntityManager({ 'seller-1': bal });
      dataSource.transaction.mockImplementation((cb) => cb(em));

      const result = await service.requestWithdrawal('seller-1', {
        amount: 50000,
        bankCardNumber: '8600111122223333',
        bankCardHolderName: 'Ali Valiyev',
      });

      // Debt fully cleared, only the remainder (50000 - 30000 = 20000) paid out.
      expect(bal.debtBalance).toBe('0');
      expect(bal.debtDueDate).toBeNull();
      expect(bal.availableBalance).toBe(String(100000 - 50000));
      expect(result).not.toBeNull();
      expect(result!.amount).toBe(String(20000));
      expect(result!.status).toBe(WithdrawalStatus.Pending);

      // Both a debt-repaid and a withdrawal-requested transaction were recorded.
      const savedTxTypes = (em.save.mock.calls as unknown[][])
        .filter(([Entity]) => Entity === SellerTransaction)
        .map(([, data]) => (data as { type: SellerTxType }).type);
      expect(savedTxTypes).toEqual(expect.arrayContaining([SellerTxType.DebtRepaid, SellerTxType.WithdrawalRequested]));

      // Debt fully cleared → shop reactivation attempted.
      expect(em.update).toHaveBeenCalledWith(
        Shop,
        { ownerId: 'seller-1', deactivatedByDebt: true },
        { isActive: true, deactivatedByDebt: false },
      );
    });

    it('qarz so\'ralgan summadan katta/teng: butun summa qarzga ketadi, payout yaratilmaydi, lekin qarz kamayishi saqlanadi', async () => {
      // This is the regression this test locks in: even when the entire
      // requested amount is absorbed by debt (no payout), the debt reduction
      // must still be committed — not silently dropped along with the throw.
      const bal = makeBalance({ sellerId: 'seller-1', availableBalance: '50000', debtBalance: '100000' });
      const em = mockEntityManager({ 'seller-1': bal });
      dataSource.transaction.mockImplementation((cb) => cb(em));

      await expect(
        service.requestWithdrawal('seller-1', {
          amount: 30000,
          bankCardNumber: '8600111122223333',
          bankCardHolderName: 'Ali Valiyev',
        }),
      ).rejects.toThrow("qarzni to'lash uchun sarflandi");

      // The debt repayment actually happened, wasn't rolled back.
      expect(bal.debtBalance).toBe(String(100000 - 30000));
      expect(bal.availableBalance).toBe(String(50000 - 30000));
      // No withdrawal request should have been created.
      expect(withdrawals.save).not.toHaveBeenCalled();
      const savedTxTypes = (em.save.mock.calls as unknown[][])
        .filter(([Entity]) => Entity === SellerTransaction)
        .map(([, data]) => (data as { type: SellerTxType }).type);
      expect(savedTxTypes).toEqual([SellerTxType.DebtRepaid]);
    });

    it('qarz yo\'q bo\'lsa: butun summa (mavjud balansdan oshmagan holda) chiqariladi', async () => {
      const bal = makeBalance({ sellerId: 'seller-1', availableBalance: '100000', debtBalance: '0' });
      const em = mockEntityManager({ 'seller-1': bal });
      dataSource.transaction.mockImplementation((cb) => cb(em));

      const result = await service.requestWithdrawal('seller-1', {
        amount: 40000,
        bankCardNumber: '8600111122223333',
        bankCardHolderName: 'Ali Valiyev',
      });

      expect(result!.amount).toBe(String(40000));
      expect(bal.availableBalance).toBe(String(60000));
      const savedTxTypes = (em.save.mock.calls as unknown[][])
        .filter(([Entity]) => Entity === SellerTransaction)
        .map(([, data]) => (data as { type: SellerTxType }).type);
      expect(savedTxTypes).not.toContain(SellerTxType.DebtRepaid);
    });

    it('so\'ralgan summa mavjud balansdan oshsa, faqat mavjud qadar chiqariladi', async () => {
      const bal = makeBalance({ sellerId: 'seller-1', availableBalance: '20000', debtBalance: '0' });
      const em = mockEntityManager({ 'seller-1': bal });
      dataSource.transaction.mockImplementation((cb) => cb(em));

      const result = await service.requestWithdrawal('seller-1', {
        amount: 50000,
        bankCardNumber: '8600111122223333',
        bankCardHolderName: 'Ali Valiyev',
      });

      expect(result!.amount).toBe(String(20000));
      expect(bal.availableBalance).toBe('0');
    });

    it('balans topilmasa xato tashlaydi', async () => {
      const em = mockEntityManager({});
      dataSource.transaction.mockImplementation((cb) => cb(em));

      await expect(
        service.requestWithdrawal('seller-x', { amount: 1000, bankCardNumber: '1', bankCardHolderName: 'A' }),
      ).rejects.toThrow('Balans topilmadi');
    });

    it('mavjud balans 0 yoki manfiy bo\'lsa rad etadi', async () => {
      const bal = makeBalance({ sellerId: 'seller-1', availableBalance: '0', debtBalance: '0' });
      const em = mockEntityManager({ 'seller-1': bal });
      dataSource.transaction.mockImplementation((cb) => cb(em));

      await expect(
        service.requestWithdrawal('seller-1', { amount: 1000, bankCardNumber: '1', bankCardHolderName: 'A' }),
      ).rejects.toThrow("mablag' yo'q");
    });
  });

  describe('autoRepayDebt', () => {
    it('balans topilmasa hech narsa qilmaydi', async () => {
      balances.findOne.mockResolvedValue(null);
      await service.autoRepayDebt('seller-1');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('qarz yoki mavjud balans 0 bo\'lsa tranzaksiya ochmaydi', async () => {
      balances.findOne.mockResolvedValue(makeBalance({ availableBalance: '0', debtBalance: '5000' }));
      await service.autoRepayDebt('seller-1');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('qisman so\'ndiradi: mavjud balans qarzdan kichik', async () => {
      const bal = makeBalance({ sellerId: 'seller-1', availableBalance: '5000', debtBalance: '10000' });
      balances.findOne.mockResolvedValue(bal);
      const em = mockEntityManager({ 'seller-1': bal });
      dataSource.transaction.mockImplementation((cb) => cb(em));

      await service.autoRepayDebt('seller-1');

      expect(bal.availableBalance).toBe('0');
      expect(bal.debtBalance).toBe('5000');
      expect(em.update).not.toHaveBeenCalled(); // debt not fully cleared — shop stays deactivated if it was
    });

    it('qarzni to\'liq so\'ndiradi va do\'konni qayta faollashtiradi', async () => {
      const bal = makeBalance({ sellerId: 'seller-1', availableBalance: '5000', debtBalance: '3000' });
      balances.findOne.mockResolvedValue(bal);
      const em = mockEntityManager({ 'seller-1': bal });
      dataSource.transaction.mockImplementation((cb) => cb(em));

      await service.autoRepayDebt('seller-1');

      expect(bal.debtBalance).toBe('0');
      expect(bal.debtDueDate).toBeNull();
      expect(em.update).toHaveBeenCalledWith(
        Shop,
        { ownerId: 'seller-1', deactivatedByDebt: true },
        { isActive: true, deactivatedByDebt: false },
      );
    });
  });

  describe('settlePendingTransactions (cron)', () => {
    it('pending tranzaksiya bo\'lmasa hech narsa qilmaydi', async () => {
      txs.find.mockResolvedValue([]);
      await service.settlePendingTransactions();
      expect(complaints.openComplaintOrderIds).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('ochiq shikoyat ostidagi buyurtmani hisob-kitob qilmasdan o\'tkazib yuboradi', async () => {
      const disputed = pendingTx({ id: 'tx-disputed', sellerId: 'seller-1', orderId: 'order-1', amount: '1000' });
      const clean = pendingTx({ id: 'tx-clean', sellerId: 'seller-2', orderId: 'order-2', amount: '2000' });
      txs.find.mockResolvedValue([disputed, clean]);
      complaints.openComplaintOrderIds.mockResolvedValue(new Set(['order-1']));

      const balSeller2 = makeBalance({ sellerId: 'seller-2', pendingBalance: '2000', availableBalance: '0' });
      // seller-2 has no debt, so autoRepayDebt's cheap precheck exits early —
      // no second transaction needed inside this test.
      balances.findOne.mockResolvedValue(balSeller2);
      const em = mockEntityManager({ 'seller-2': balSeller2 });
      dataSource.transaction.mockImplementation((cb) => cb(em));

      await service.settlePendingTransactions();

      expect(complaints.openComplaintOrderIds).toHaveBeenCalledWith(['order-1', 'order-2']);
      // Only the non-disputed transaction went through a settlement transaction.
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(disputed.status).toBe('pending');
      expect(clean.status).toBe('settled');
      expect(balSeller2.pendingBalance).toBe('0');
      expect(balSeller2.availableBalance).toBe('2000');
    });

    it('barcha pending tranzaksiyalar shikoyat ostida bo\'lsa birontasini ham hisob-kitob qilmaydi', async () => {
      const disputed = pendingTx({ id: 'tx-1', sellerId: 'seller-1', orderId: 'order-1' });
      txs.find.mockResolvedValue([disputed]);
      complaints.openComplaintOrderIds.mockResolvedValue(new Set(['order-1']));

      await service.settlePendingTransactions();

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(disputed.status).toBe('pending');
    });
  });

  describe('adminForceSettle', () => {
    it('tranzaksiya topilmasa NotFoundException', async () => {
      const em = mockEntityManager({});
      dataSource.transaction.mockImplementation((cb) => cb(em));
      await expect(service.adminForceSettle('tx-1', 'admin-1')).rejects.toThrow(NotFoundException);
    });

    it('pending online bo\'lmagan tranzaksiyani rad etadi', async () => {
      const tx = { id: 'tx-1', type: SellerTxType.DebtRepaid, status: 'settled' } as SellerTransaction;
      const em = mockEntityManager({}, { 'tx-1': tx });
      dataSource.transaction.mockImplementation((cb) => cb(em));
      await expect(service.adminForceSettle('tx-1', 'admin-1')).rejects.toThrow(BadRequestException);
    });

    it('pending online tranzaksiyani muvaffaqiyatli chiqaradi', async () => {
      const tx = pendingTx({ id: 'tx-1', sellerId: 'seller-1', amount: '5000' });
      const bal = makeBalance({ sellerId: 'seller-1', pendingBalance: '5000', availableBalance: '0' });
      balances.findOne.mockResolvedValue(bal); // used by autoRepayDebt's precheck (debt=0 → exits early)
      const em = mockEntityManager({ 'seller-1': bal }, { 'tx-1': tx });
      dataSource.transaction.mockImplementation((cb) => cb(em));
      txs.findOneOrFail.mockResolvedValue({ ...tx, status: 'settled' });

      const result = await service.adminForceSettle('tx-1', 'admin-1');

      expect(bal.pendingBalance).toBe('0');
      expect(bal.availableBalance).toBe('5000');
      expect(tx.status).toBe('settled');
      expect(result.status).toBe('settled');
    });
  });

  describe('adminForceRefund', () => {
    it('tranzaksiya topilmasa NotFoundException', async () => {
      const em = mockEntityManager({});
      dataSource.transaction.mockImplementation((cb) => cb(em));
      await expect(service.adminForceRefund('tx-1', 'admin-1')).rejects.toThrow(NotFoundException);
    });

    it('pending online tranzaksiyani muvaffaqiyatli qaytaradi (available ga tegmaydi)', async () => {
      const tx = pendingTx({ id: 'tx-1', sellerId: 'seller-1', amount: '5000' });
      const bal = makeBalance({ sellerId: 'seller-1', pendingBalance: '5000', availableBalance: '1000' });
      const em = mockEntityManager({ 'seller-1': bal }, { 'tx-1': tx });
      dataSource.transaction.mockImplementation((cb) => cb(em));
      txs.findOneOrFail.mockResolvedValue({ ...tx, status: 'cancelled' });

      const result = await service.adminForceRefund('tx-1', 'admin-1');

      expect(bal.pendingBalance).toBe('0');
      expect(bal.availableBalance).toBe('1000'); // unchanged — money returns to platform, not the seller
      expect(tx.status).toBe('cancelled');
      expect(result.status).toBe('cancelled');
      // Unlike force-settle, force-refund never tries to auto-repay debt.
      expect(balances.findOne).not.toHaveBeenCalled();
    });
  });
});
