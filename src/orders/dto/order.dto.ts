import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';


import { OrderChannel, OrderStatus, PaymentMethod, PaymentStatus } from '../entities/order.entity';

export class OrderItemDto {
  @ApiProperty()
  @IsUUID()
  productVariantId!: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateOrderDto {
  @ApiProperty()
  @IsUUID()
  shopId!: string;

  @ApiProperty()
  @IsUUID()
  deliveryAddressId!: string;

  @ApiProperty({ type: [OrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];

  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.Cash })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ example: '+998901234567', description: 'Defaults to the customer\'s own phone if omitted' })
  @IsOptional()
  @Matches(/^\+998\d{9}$/)
  recipientPhone?: string;

  @ApiPropertyOptional({ description: 'Free-text note to the courier' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  courierComment?: string;
}

export class AssignOrderDto {
  @ApiPropertyOptional({ description: 'ShopStaff.id; null = biriktirishni bekor qilish' })
  @IsOptional()
  @IsUUID()
  staffId?: string | null;
}

export class UpdateCourierLocationDto {
  @ApiProperty()
  @IsLatitude()
  lat!: number;

  @ApiProperty()
  @IsLongitude()
  lng!: number;
}

export class InStoreSaleDto {
  @ApiProperty({ type: [OrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];
}

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus })
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class ChangePaymentMethodDto {
  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;
}

export class ReturnReasonDto {
  @ApiProperty({ example: 'Pomidor chirigan edi' })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class SendMessageDto {
  @ApiProperty({ example: 'Buyurtma tayyormi?' })
  @IsString()
  @MaxLength(1000)
  text!: string;
}

export class ReviewItemDto {
  @ApiProperty()
  @IsUUID()
  productVariantId!: string;

  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  stars!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  text?: string;
}

export class CreateReviewsDto {
  @ApiProperty({ type: [ReviewItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReviewItemDto)
  items!: ReviewItemDto[];
}

export class ReturnItemDto {
  @ApiProperty()
  @IsUUID()
  orderItemId!: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class PartialReturnDto {
  @ApiProperty({ type: [ReturnItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items!: ReturnItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class AdminListOrdersQuery {
  @ApiPropertyOptional({ description: 'Buyurtma raqami, mijoz ismi/telefoni yoki do\'kon nomi' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  search?: string;

  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({ enum: OrderChannel })
  @IsOptional()
  @IsEnum(OrderChannel)
  channel?: OrderChannel;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  shopId?: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-01-31' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateTo?: string;

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class SetCommissionExemptDto {
  @ApiProperty()
  @IsBoolean()
  exempt!: boolean;
}
