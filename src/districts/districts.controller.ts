import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseFloatPipe,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/decorators/public.decorator';
import { DistrictsService } from './districts.service';

@ApiTags('districts')
@Controller('districts')
export class DistrictsController {
  constructor(private readonly districtsService: DistrictsService) {}

  @Public()
  @Get('current')
  async getCurrent(
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lng', ParseFloatPipe) lng: number,
  ) {
    const district = await this.districtsService.getCurrentDistrict(lat, lng);
    if (!district) {
      throw new NotFoundException('District not found for given coordinates');
    }
    return district;
  }

  @Public()
  @Get()
  async getAll() {
    return this.districtsService.findAll();
  }

  @Public()
  @Get(':id')
  async getOne(@Param('id', ParseUUIDPipe) id: string) {
    const district = await this.districtsService.findOne(id);
    if (!district) {
      throw new NotFoundException('District not found');
    }
    return district;
  }
}
