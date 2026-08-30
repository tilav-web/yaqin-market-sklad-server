import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

/**
 * Where a GPS fix came from. There is no `provider` field on
 * `expo-location`'s `LocationObject` — this is our own capture-mode tag.
 * `last_known` can be up to a minute and kilometres stale, so callers must
 * never run a distance rule against `last_known` evidence, only record it.
 */
export type EvidenceSource =
  | 'foreground'
  | 'background'
  | 'last_known'
  | 'map_pick';

const EVIDENCE_SOURCES: EvidenceSource[] = [
  'foreground',
  'background',
  'last_known',
  'map_pick',
];

/** What the client sends. Every field is an unverified claim. */
export class LocationEvidenceDto {
  @ApiPropertyOptional()
  @IsLatitude()
  latitude!: number;

  @ApiPropertyOptional()
  @IsLongitude()
  longitude!: number;

  /** Metres, from the OS. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  accuracy?: number;

  /** Device clock at fix time — untrusted, never used for ordering/retention. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  capturedAt?: string;

  /** Android mock-location flag. Always undefined on iOS. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  mocked?: boolean;

  @ApiPropertyOptional({ enum: EVIDENCE_SOURCES })
  @IsOptional()
  @IsIn(EVIDENCE_SOURCES)
  source?: EvidenceSource;
}

/** What gets persisted. `deviceId`/`receivedAt`/`skewMs` are server-stamped and can't be forged. */
export interface LocationEvidence {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  capturedAt: string | null;
  mocked: boolean | null;
  source: EvidenceSource;
  deviceId: string | null;
  /** Server clock — the only trustworthy timestamp in this record. */
  receivedAt: string;
  /** receivedAt − capturedAt, ms. Null when capturedAt is absent. */
  skewMs: number | null;
  actorUserId: string;
  actorRole: 'customer' | 'shop';
}

export function buildEvidence(
  dto: LocationEvidenceDto | null | undefined,
  ctx: {
    deviceId: string | null;
    actorUserId: string;
    actorRole: 'customer' | 'shop';
  },
): LocationEvidence | null {
  if (!dto) return null;
  const receivedAt = new Date();
  const capturedAt = dto.capturedAt ?? null;
  const skewMs = capturedAt
    ? receivedAt.getTime() - new Date(capturedAt).getTime()
    : null;
  return {
    latitude: dto.latitude,
    longitude: dto.longitude,
    accuracy: dto.accuracy ?? null,
    capturedAt,
    mocked: dto.mocked ?? null,
    source: dto.source ?? 'foreground',
    deviceId: ctx.deviceId,
    receivedAt: receivedAt.toISOString(),
    skewMs,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
  };
}
