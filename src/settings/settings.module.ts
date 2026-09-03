import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { GlobalSetting } from './entities/global-setting.entity';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [TypeOrmModule.forFeature([GlobalSetting]), UploadsModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
