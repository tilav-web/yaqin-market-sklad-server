import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { ChatTemplatesService } from './chat-templates.service';

@ApiBearerAuth()
@ApiTags('chat-templates')
@Controller('seller/shops/:shopId/chat-templates')
export class ChatTemplatesController {
  constructor(private readonly svc: ChatTemplatesService) {}

  @Get()
  list(@Param('shopId', ParseUUIDPipe) shopId: string) {
    return this.svc.list(shopId);
  }

  @Post()
  create(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: { text: string },
  ) {
    return this.svc.create(shopId, dto.text);
  }

  @Put(':id')
  update(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { text: string },
  ) {
    return this.svc.update(shopId, id, dto.text);
  }

  @Delete(':id')
  remove(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.remove(shopId, id);
  }

  @Put('reorder/batch')
  reorder(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: { ids: string[] },
  ) {
    return this.svc.reorder(shopId, dto.ids);
  }
}
