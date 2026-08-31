import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/role.enum';
import { sendXlsx } from '../common/xlsx.util';
import { DeviceId } from '../common/device-id.decorator';
import { RedisService } from '../redis/redis.service';
import {
  AdminListOrdersQuery,
  AdminListReviewsQuery,
  AssignOrderDto,
  ChangePaymentMethodDto,
  CreateOrderDto,
  CreateReviewsDto,
  InStoreSaleDto,
  PartialReturnDto,
  RateOrderPartyDto,
  ReturnReasonDto,
  SendMessageDto,
  SetCommissionExemptDto,
  SetMarkingCodesDto,
  UpdateCourierLocationDto,
  UpdateOrderStatusDto,
  VerifyHandshakeDto,
} from './dto/order.dto';
import { OrderStatus } from './entities/order.entity';
import { OrdersService } from './orders.service';

@ApiBearerAuth()
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly redis: RedisService,
  ) {}

  /** Customer: get live courier location while order is delivering. */
  @Get(':id/courier-location')
  async getCourierLocation(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    // Only a party to the order (customer, shop owner, or shop staff) may read it.
    await this.orders.assertOrderParty(user.sub, id);
    const raw = await this.redis.client.get(`courier:location:${id}`);
    if (!raw) return null;
    return JSON.parse(raw) as {
      orderId: string;
      lat: number;
      lng: number;
      etaMinutes: number | null;
      updatedAt: string;
    };
  }

  /**
   * Courier: report live position while delivering. Called on a periodic
   * foreground interval and — critically — from the background location
   * task once the OS wakes the app up while the screen is locked. A plain
   * REST call (rather than a socket emit) because a background task's JS
   * context is too short-lived/isolated to keep a WebSocket connection alive.
   */
  @Post(':id/courier-location')
  reportCourierLocation(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCourierLocationDto,
    @DeviceId() deviceId: string | null,
  ) {
    return this.orders.updateCourierLocation(user.sub, id, dto.lat, dto.lng, {
      evidence: {
        latitude: dto.lat,
        longitude: dto.lng,
        accuracy: dto.accuracy,
        capturedAt: dto.capturedAt,
        mocked: dto.mocked,
        source: dto.source ?? 'background',
      },
      deviceId,
    });
  }

  /** Customer: every currently-active order at once, for the multi-order live map. */
  @Get('active-deliveries')
  listActiveDeliveries(@CurrentUser() user: JwtPayload) {
    return this.orders.listActiveDeliveries(user.sub);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateOrderDto,
    @DeviceId() deviceId: string | null,
  ) {
    return this.orders.create(user.sub, dto, deviceId);
  }

  @Get('mine')
  listMine(@CurrentUser() user: JwtPayload) {
    return this.orders.listForUser(user.sub);
  }

  @Get(':id')
  getOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.getOne(user.sub, id);
  }

  /** Customer or shop owner: get official fiscal receipt with OFD QR code and Soliq details. */
  @Get(':id/fiscal-receipt')
  getFiscalReceipt(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.getFiscalReceipt(user.sub, user.roles, id);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
    @DeviceId() deviceId: string | null,
  ) {
    return this.orders.updateStatus(user.sub, id, dto.status, dto.note, {
      evidence: dto.evidence,
      deviceId,
    });
  }

  /** Customer: re-ask the silent shop for a paid order — restarts the 5-min window. */
  @Post(':id/re-request')
  reRequest(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.reRequestOrder(user.sub, id);
  }

  /** Customer: switch cash <-> card before the order is paid (locked afterwards). */
  @Patch(':id/payment-method')
  changePaymentMethod(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangePaymentMethodDto,
  ) {
    return this.orders.changePaymentMethod(user.sub, id, dto.paymentMethod);
  }

  @Post(':id/return')
  returnItems(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PartialReturnDto,
  ) {
    return this.orders.partialReturn(user.sub, id, dto.items, dto.reason);
  }

  /** Seller/yig'uvchi: markirovkali tovarlarning Data Matrix kodlarini saqlash. */
  @Put(':id/marking-codes')
  setMarkingCodes(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetMarkingCodesDto,
  ) {
    return this.orders.setMarkingCodes(user.sub, id, dto.items);
  }

  @Post(':id/return-reason')
  setReturnReason(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnReasonDto,
  ) {
    return this.orders.setReturnReason(user.sub, id, dto.reason);
  }

  @Post(':id/reviews')
  reviewItems(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateReviewsDto,
  ) {
    return this.orders.createReviews(user.sub, id, dto.items);
  }

  /** Customer: rate the courier who confirmed delivery — separate from per-product reviews. */
  @Post(':id/review-courier')
  reviewCourier(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RateOrderPartyDto,
  ) {
    return this.orders.rateCourier(user.sub, id, dto.stars, dto.text);
  }

  /** Customer: rate the shop/delivery experience — separate from per-product reviews. */
  @Post(':id/review-shop')
  reviewShop(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RateOrderPartyDto,
  ) {
    return this.orders.rateShop(user.sub, id, dto.stars, dto.text);
  }

  /** Customer: fetch (lazily issuing) the QR handshake token — `required` is almost always false. */
  @Get(':id/handshake')
  getHandshake(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.getHandshake(user.sub, id);
  }

  /** Courier: verify a scanned QR handshake before marking delivered. */
  @Post(':id/handshake/verify')
  verifyHandshake(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyHandshakeDto,
  ) {
    return this.orders.verifyHandshake(user.sub, id, dto.token);
  }

  @Get(':id/messages')
  listMessages(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.listMessages(user.sub, id);
  }

  @Post(':id/messages')
  sendMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.orders.sendMessage(user.sub, id, dto.text);
  }
}

@ApiBearerAuth()
@ApiTags('seller-orders')
@Controller('seller/shops/:shopId/orders')
export class SellerOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Query('status') status?: OrderStatus,
  ) {
    return this.orders.listForShop(user.sub, shopId, status);
  }

  // In-store counter sale (scan/pick → ring up → done).
  @Post('instore')
  inStoreSale(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: InStoreSaleDto,
  ) {
    return this.orders.createInStoreSale(user.sub, shopId, dto.items);
  }

  // Assign an order to a staff member (e.g. courier). staffId null = unassign.
  @Post(':orderId/assign')
  assign(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: AssignOrderDto,
  ) {
    return this.orders.assignOrder(
      user.sub,
      shopId,
      orderId,
      dto.staffId ?? null,
    );
  }

  /** Nearest-neighbor greedy delivery route for this shop's 'delivering' orders (SPEC.md §27). */
  @Get('delivery-route')
  deliveryRoute(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
  ) {
    return this.orders.getDeliveryRoute(user.sub, shopId);
  }
}

/** Platform-wide order browser — support/moderation, not tied to one user or shop. */
@ApiBearerAuth()
@ApiTags('admin-orders')
@Roles(Role.Admin)
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Query() query: AdminListOrdersQuery) {
    return this.orders.adminListOrders(query);
  }

  // Must come before ':id' — otherwise "export" would be captured by the
  // :id param and rejected by ParseUUIDPipe as an invalid UUID.
  @Get('export')
  async export(@Query() query: AdminListOrdersQuery, @Res() res: Response) {
    const buf = await this.orders.adminExportOrders(query);
    sendXlsx(res, buf, 'buyurtmalar.xlsx');
  }

  @Get(':id')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.adminGetOrder(id);
  }

  @Patch(':id/exempt')
  setExempt(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCommissionExemptDto,
  ) {
    return this.orders.adminSetCommissionExempt(id, dto.exempt, admin.sub);
  }
}

/** Platform-wide review queue — was previously invisible to admins entirely. */
@ApiBearerAuth()
@ApiTags('admin-reviews')
@Roles(Role.Admin)
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Query() query: AdminListReviewsQuery) {
    return this.orders.adminListReviews(query);
  }
}
