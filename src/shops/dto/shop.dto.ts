import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
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
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

import { LocationEvidenceDto } from '../../geo/location-evidence';

/**
 * A valid GeoJSON Polygon needs every ring to have >=4 [lng, lat] points
 * (closed: first === last) with coordinates in range. Without this, a
 * malformed polygon (e.g. 1-2 points) saves successfully but pointInPolygon
 * then treats it as containing nothing — every delivery-zone check silently
 * rejects every order for that shop with no error surfaced anywhere.
 */
@ValidatorConstraint({ name: 'geoJsonPolygonCoordinates', async: false })
class GeoJsonPolygonCoordinatesConstraint implements ValidatorConstraintInterface {
  validate(coordinates: unknown): boolean {
    if (!Array.isArray(coordinates) || coordinates.length === 0) return false;
    return coordinates.every((ring: unknown) => {
      if (!Array.isArray(ring) || ring.length < 4) return false;
      return ring.every((point: unknown) => {
        if (!Array.isArray(point) || point.length !== 2) return false;
        const [lng, lat] = point as [unknown, unknown];
        return (
          typeof lng === 'number' && lng >= -180 && lng <= 180 &&
          typeof lat === 'number' && lat >= -90 && lat <= 90
        );
      });
    });
  }

  defaultMessage(): string {
    return 'coordinates har bir halqasi kamida 4 ta [lng, lat] nuqtadan iborat bo\'lishi va diapazonda bo\'lishi kerak';
  }
}

export class ToggleOpenDto {
  @ApiProperty()
  @IsBoolean()
  isOpen!: boolean;
}

export class BlockUserDto {
  @ApiProperty()
  @IsUUID()
  userId!: string;
}

export class AcceptInvitationDto {
  @ApiProperty()
  @IsString()
  @MaxLength(256)
  token!: string;
}

export class AdminListShopsQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  search?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class AdminSetActiveDto {
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

import { ALL_STAFF_PERMISSIONS, StaffRole } from '../entities/shop-staff.entity';
import type { StaffPermission, StaffPreset } from '../entities/shop-staff.entity';
import type { DeliveryPricingType, Holiday, WorkingHourSlot } from '../entities/shop.entity';

const STAFF_ROLES: StaffRole[] = ['cashier', 'storekeeper', 'courier', 'manager', 'custom'];
const STAFF_PRESETS: StaffPreset[] = [
  'cashier',
  'storekeeper',
  'courier',
  'manager',
  'kassir',
  'omborchi',
  'kuryer',
  'menejer',
  'sklad',
  'yetkazib_beruvchi',
  'custom',
];

export class WorkingHourSlotDto implements WorkingHourSlot {
  @ApiProperty({ minimum: 0, maximum: 6 })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: 0 | 1 | 2 | 3 | 4 | 5 | 6;

  @ApiProperty({ example: '08:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  openTime!: string;

  @ApiProperty({ example: '22:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  closeTime!: string;

  @ApiProperty()
  @IsBoolean()
  isOpen!: boolean;
}

export class HolidayDto implements Holiday {
  @ApiProperty({ example: '2026-01-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class DeliveryZoneDto {
  @ApiProperty({ example: 4 })
  @IsNumber()
  @Min(0.1)
  maxKm!: number;

  @ApiProperty({ example: 2 })
  @IsNumber()
  @Min(0)
  freeKm!: number;

  @ApiProperty({ enum: ['flat', 'per_km', 'per_500m', 'per_100m'] })
  @IsEnum(['flat', 'per_km', 'per_500m', 'per_100m'])
  pricingType!: DeliveryPricingType;

  @ApiProperty({ example: 5000 })
  @IsInt()
  @Min(0)
  pricePerStep!: number;
}

export class CreateShopDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  name!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(512)
  address!: string;

  @ApiProperty()
  @IsLatitude()
  latitude!: number;

  @ApiProperty()
  @IsLongitude()
  longitude!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  photos?: string[];

  @ApiPropertyOptional({ description: 'Contact phone for customer inquiries' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({ description: 'Whether shop supports online delivery (default true)' })
  @IsOptional()
  @IsBoolean()
  isDeliveryEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Whether in-store pickup / walk-in is supported (default true)' })
  @IsOptional()
  @IsBoolean()
  isPickupEnabled?: boolean;

  @ApiPropertyOptional({ type: [WorkingHourSlotDto], description: 'Independent delivery schedule' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkingHourSlotDto)
  deliveryHours?: WorkingHourSlotDto[];

  /** Best-effort device fix at the moment this pin was set (anti-fraud). */
  @ApiPropertyOptional({ type: LocationEvidenceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationEvidenceDto)
  evidence?: LocationEvidenceDto;
}

export class UpdateShopDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  photos?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDeliveryEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPickupEnabled?: boolean;

  @ApiPropertyOptional({ type: [WorkingHourSlotDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkingHourSlotDto)
  deliveryHours?: WorkingHourSlotDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLongitude()
  longitude?: number;

  /** Best-effort device fix at the moment this pin was set (anti-fraud). */
  @ApiPropertyOptional({ type: LocationEvidenceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationEvidenceDto)
  evidence?: LocationEvidenceDto;

  @ApiPropertyOptional({ type: [WorkingHourSlotDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkingHourSlotDto)
  workingHours?: WorkingHourSlotDto[];

  @ApiPropertyOptional({ type: [HolidayDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HolidayDto)
  holidays?: HolidayDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isOpenManual?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  minOrderPrice?: number;

  @ApiPropertyOptional({ type: DeliveryZoneDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryZoneDto)
  deliveryZone?: DeliveryZoneDto;
}

export class GeoJsonPolygonDto {
  @ApiProperty()
  @IsIn(['Polygon'])
  type!: 'Polygon';

  @ApiProperty()
  @IsArray()
  @ArrayMinSize(1)
  @Validate(GeoJsonPolygonCoordinatesConstraint)
  coordinates!: [number, number][][];
}

export class UpdateStaffDto {
  @ApiPropertyOptional({ enum: ALL_STAFF_PERMISSIONS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ALL_STAFF_PERMISSIONS.length)
  @IsIn(ALL_STAFF_PERMISSIONS, { each: true })
  permissions?: StaffPermission[];

  @ApiPropertyOptional({ enum: STAFF_PRESETS })
  @IsOptional()
  @IsIn(STAFF_PRESETS)
  preset?: StaffPreset;

  @ApiPropertyOptional({ enum: STAFF_ROLES, isArray: true, description: 'Multi-roles: kassir, omborchi, kuryer, menejer' })
  @IsOptional()
  @IsArray()
  @IsIn(STAFF_ROLES, { each: true })
  roles?: StaffRole[];

  /** Apply a seller-saved custom preset's permissions (see ShopStaffPreset) instead of a system preset. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customPresetId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  customRoleName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateInvitationDto {
  @ApiPropertyOptional({ enum: STAFF_PRESETS, description: 'System preset to grant at invite time' })
  @IsOptional()
  @IsIn(STAFF_PRESETS)
  preset?: StaffPreset;

  @ApiPropertyOptional({ enum: STAFF_ROLES, isArray: true, description: 'Multi-roles: kassir, omborchi, kuryer, menejer' })
  @IsOptional()
  @IsArray()
  @IsIn(STAFF_ROLES, { each: true })
  roles?: StaffRole[];

  /** A seller-saved custom preset's permissions (see ShopStaffPreset) — alternative to `preset`. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customPresetId?: string;

  @ApiPropertyOptional({ enum: ALL_STAFF_PERMISSIONS, description: 'Explicit permission list — alternative to preset/customPresetId' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ALL_STAFF_PERMISSIONS.length)
  @IsIn(ALL_STAFF_PERMISSIONS, { each: true })
  permissions?: StaffPermission[];

  @ApiPropertyOptional({ example: 'Kechki kassir' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  customRoleName?: string;
}

export class CreateStaffPresetDto {
  @ApiProperty({ example: 'Kechki kassir' })
  @IsString()
  @MaxLength(64)
  name!: string;

  @ApiProperty({ enum: ALL_STAFF_PERMISSIONS })
  @IsArray()
  @ArrayMaxSize(ALL_STAFF_PERMISSIONS.length)
  @IsIn(ALL_STAFF_PERMISSIONS, { each: true })
  permissions!: StaffPermission[];
}

export class UpdateStaffPresetDto {
  @ApiPropertyOptional({ example: 'Kechki kassir' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  @ApiPropertyOptional({ enum: ALL_STAFF_PERMISSIONS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ALL_STAFF_PERMISSIONS.length)
  @IsIn(ALL_STAFF_PERMISSIONS, { each: true })
  permissions?: StaffPermission[];
}

export class UpdateDeliveryZonesDto {
  @ApiPropertyOptional({ type: GeoJsonPolygonDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => GeoJsonPolygonDto)
  deliveryPolygon?: GeoJsonPolygonDto | null;

  @ApiPropertyOptional({ type: GeoJsonPolygonDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => GeoJsonPolygonDto)
  freeDeliveryPolygon?: GeoJsonPolygonDto | null;
}
