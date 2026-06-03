import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import {
  CreateOrderDto,
  CreateReviewsDto,
  InStoreSaleDto,
  PartialReturnDto,
  ReturnReasonDto,
  SendMessageDto,
  UpdateOrderStatusDto,
} from './dto/order.dto';
import { OrderStatus } from './entities/order.entity';
import { OrdersService } from './orders.service';

@ApiBearerAuth()
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateOrderDto) {
    return this.orders.create(user.sub, dto);
  }

  @Get('mine')
  listMine(@CurrentUser() user: JwtPayload) {
    return this.orders.listForUser(user.sub);
  }

  @Get(':id')
  getOne(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.getOne(user.sub, id);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.orders.updateStatus(user.sub, id, dto.status, dto.note);
  }

  @Post(':id/return')
  returnItems(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PartialReturnDto,
  ) {
    return this.orders.partialReturn(user.sub, id, dto.items, dto.reason);
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

  @Get(':id/messages')
  listMessages(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
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
    @Body() body: { staffId: string | null },
  ) {
    return this.orders.assignOrder(user.sub, shopId, orderId, body.staffId ?? null);
  }
}
