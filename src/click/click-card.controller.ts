import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { AddCardDto } from './dto/add-card.dto';
import { VerifyCardDto } from './dto/verify-card.dto';
import { ClickCardService } from './click-card.service';

@Controller('click/cards')
export class ClickCardController {
  constructor(private readonly cards: ClickCardService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.cards.listCards(user.sub);
  }

  // Card-testing fraud (probing stolen card numbers) targets exactly this
  // endpoint — much tighter than the global 60/min default.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  add(@CurrentUser() user: JwtPayload, @Body() dto: AddCardDto) {
    return this.cards.addCard(user.sub, dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':id/verify')
  verify(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyCardDto,
  ) {
    return this.cards.verifyCard(user.sub, id, dto);
  }

  @Patch(':id/default')
  setDefault(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.cards.setDefaultCard(user.sub, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.cards.deleteCard(user.sub, id);
  }
}
