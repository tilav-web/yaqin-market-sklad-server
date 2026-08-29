import { randomUUID } from 'crypto';
import { Readable } from 'stream';

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UploadsService } from '../uploads/uploads.service';
import { AppRelease } from './entities/app-release.entity';
import { toLocalizedText } from '../common/types/localized-text.type';

const APK_CONTENT_TYPE = 'application/vnd.android.package-archive';

/** X.Y.Z only (enforced by CreateReleaseDto) — null for anything that doesn't parse. */
function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** >0 if a>b, <0 if a<b, 0 if equal. An unparseable version never outranks a parseable one. */
function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

@Injectable()
export class AppReleasesService {
  constructor(
    @InjectRepository(AppRelease)
    private readonly releases: Repository<AppRelease>,
    private readonly uploads: UploadsService,
  ) {}

  async create(
    version: string,
    notes: string | undefined,
    file: Buffer,
  ): Promise<AppRelease> {
    const fileKey = `apk/${randomUUID()}.apk`;
    await this.uploads.uploadBuffer(file, fileKey, APK_CONTENT_TYPE);

    // Only actually promote this upload to "latest" if its version number is
    // >= whatever's currently latest — re-uploading an accidentally-older
    // build must not push users backward. Still saved as a normal release
    // either way, just not flagged as latest.
    const currentLatest = await this.releases.findOne({ where: { isLatest: true } });
    const becomesLatest = !currentLatest || compareSemver(version, currentLatest.version) >= 0;
    if (becomesLatest && currentLatest) {
      await this.releases.update({ id: currentLatest.id }, { isLatest: false });
    }

    const release = this.releases.create({
      version,
      notes: notes ? toLocalizedText(notes) : null,
      fileKey,
      sizeBytes: file.length,
      isLatest: becomesLatest,
    });
    return this.releases.save(release);
  }

  list(): Promise<AppRelease[]> {
    return this.releases.find({ order: { createdAt: 'DESC' } });
  }

  getLatest(): Promise<AppRelease | null> {
    return this.releases.findOne({ where: { isLatest: true } });
  }

  async getApkStream(
    key: string,
  ): Promise<{ stream: Readable; size: number }> {
    const { stream, size } = await this.uploads.getObject(key);
    return { stream, size };
  }

  async remove(id: string): Promise<void> {
    const release = await this.releases.findOne({ where: { id } });
    if (!release) throw new NotFoundException('Versiya topilmadi');
    await this.uploads.remove(release.fileKey);
    await this.releases.remove(release);
    // If we removed the latest, promote whichever REMAINING release has the
    // highest version number — not just the most recently uploaded one,
    // which could easily be an older build re-uploaded later.
    if (release.isLatest) {
      const remaining = await this.releases.find();
      if (remaining.length > 0) {
        const highest = remaining.reduce((best, r) => (compareSemver(r.version, best.version) > 0 ? r : best));
        highest.isLatest = true;
        await this.releases.save(highest);
      }
    }
  }
}
