import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DistrictsController } from './districts.controller';
import { DistrictsService } from './districts.service';
import { District } from './entities/district.entity';
import { Region } from './entities/region.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Region, District])],
  controllers: [DistrictsController],
  providers: [DistrictsService],
  exports: [DistrictsService],
})
export class DistrictsModule {}
