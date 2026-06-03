import { randomUUID } from 'crypto';
import { Readable } from 'stream';

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UploadsService } from '../uploads/uploads.service';
import { AppRelease } from './entities/app-release.entity';

const APK_CONTENT_TYPE = 'application/vnd.android.package-archive';

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
    // New upload becomes the single "latest" build.
    await this.releases.update({ isLatest: true }, { isLatest: false });
    const release = this.releases.create({
      version,
      notes: notes ?? null,
      fileKey,
      sizeBytes: file.length,
      isLatest: true,
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
    // If we removed the latest, promote the most recent remaining one.
    if (release.isLatest) {
      const next = await this.releases.findOne({ order: { createdAt: 'DESC' } });
      if (next) {
        next.isLatest = true;
        await this.releases.save(next);
      }
    }
  }
}
