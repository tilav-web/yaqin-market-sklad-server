import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { OrderStatus } from '../entities/order.entity';

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
}

export class AssignOrderDto {
  @ApiPropertyOptional({ description: 'ShopStaff.id; null = biriktirishni bekor qilish' })
  @IsOptional()
  @IsUUID()
  staffId?: string | null;
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
