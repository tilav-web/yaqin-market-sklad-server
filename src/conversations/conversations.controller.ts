import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser, JwtPayload } from '../auth/decorators/current-user.decorator';
import { ConversationsService } from './conversations.service';
import { SendConversationMessageDto } from './dto/send-conversation-message.dto';

@ApiBearerAuth()
@ApiTags('conversations')
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly service: ConversationsService) {}

  @Get()
  listMyConversations(@CurrentUser() user: JwtPayload) {
    return this.service.listUserConversations(user.sub);
  }

  @Post('with-shop/:shopId')
  getOrCreateWithShop(
    @CurrentUser() user: JwtPayload,
    @Param('shopId', ParseUUIDPipe) shopId: string,
  ) {
    return this.service.getOrCreateWithShop(user.sub, shopId);
  }

  @Get(':id/messages')
  listMessages(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.listMessages(user.sub, id);
  }

  @Post(':id/messages')
  sendMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendConversationMessageDto,
  ) {
    return this.service.sendMessage(user.sub, id, dto);
  }

  @Post(':id/read')
  markAsRead(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.markAsRead(user.sub, id);
  }
}
