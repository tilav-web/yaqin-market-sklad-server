import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UploadsModule } from '../uploads/uploads.module';
import {
  AdminAppReleasesController,
  AppReleasesController,
} from './app-releases.controller';
import { AppReleasesService } from './app-releases.service';
import { AppRelease } from './entities/app-release.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AppRelease]), UploadsModule],
  controllers: [AppReleasesController, AdminAppReleasesController],
  providers: [AppReleasesService],
})
export class AppReleasesModule {}
