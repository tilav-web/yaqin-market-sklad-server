import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { ReorderChatTemplatesDto, UpsertChatTemplateDto } from './dto/chat-template.dto';
import { ChatTemplatesService } from './chat-templates.service';

@ApiBearerAuth()
@ApiTags('chat-templates')
@Controller('seller/shops/:shopId/chat-templates')
export class ChatTemplatesController {
  constructor(private readonly svc: ChatTemplatesService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload, @Param('shopId', ParseUUIDPipe) shopId: string) {
    return this.svc.list(user.sub, shopId);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: UpsertChatTemplateDto,
  ) {
    return this.svc.create(user.sub, shopId, dto.text);
  }

  @Put(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertChatTemplateDto,
  ) {
    return this.svc.update(user.sub, shopId, id, dto.text);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.remove(user.sub, shopId, id);
  }

  @Put('reorder/batch')
  reorder(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: ReorderChatTemplatesDto,
  ) {
    return this.svc.reorder(user.sub, shopId, dto.ids);
  }
}
