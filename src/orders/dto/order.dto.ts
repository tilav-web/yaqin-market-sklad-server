import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';


import { LocationEvidenceDto } from '../../geo/location-evidence';
import { OrderChannel, OrderStatus, PaymentMethod, PaymentStatus } from '../entities/order.entity';
import { ReviewTarget } from '../entities/review.entity';

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

  /** Best-effort device fix at checkout time — recorded, not enforced (anti-fraud). */
  @ApiPropertyOptional({ type: LocationEvidenceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationEvidenceDto)
  evidence?: LocationEvidenceDto;
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

  /** Metres, from the OS — anti-fraud evidence, doesn't affect the live-tracking payload. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  accuracy?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  capturedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  mocked?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['foreground', 'background', 'last_known', 'map_pick'])
  source?: 'foreground' | 'background' | 'last_known' | 'map_pick';
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

  /** Best-effort device fix at the moment of this status transition (anti-fraud). */
  @ApiPropertyOptional({ type: LocationEvidenceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationEvidenceDto)
  evidence?: LocationEvidenceDto;
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

/** Rate the courier or the shop for one order — separate from per-product reviews. */
export class RateOrderPartyDto {
  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  stars!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  text?: string;
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

export class MarkingItemDto {
  @ApiProperty()
  @IsUUID()
  orderItemId!: string;

  /** Data Matrix kodlari — har bir dona uchun bittadan. */
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  codes!: string[];
}

export class SetMarkingCodesDto {
  @ApiProperty({ type: [MarkingItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MarkingItemDto)
  items!: MarkingItemDto[];
}

export class VerifyHandshakeDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  token!: string;
}

export class AdminListReviewsQuery {
  @ApiPropertyOptional({ enum: ReviewTarget })
  @IsOptional()
  @IsEnum(ReviewTarget)
  target?: ReviewTarget;

  @ApiPropertyOptional({ description: 'Faqat shu qiymatdan past/teng baholar (masalan 2 — muammoli sharhlarni topish uchun)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  maxStars?: number;

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
