import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Request,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ClickWebhookDto } from './click-webhook.dto';
import { ClickCardService } from './click-card.service';
import { PayWithCardDto } from './dto/pay-with-card.dto';
import { ClickService } from './click.service';

@Controller('click')
export class ClickController {
  private readonly logger = new Logger(ClickController.name);

  constructor(
    private readonly clickService: ClickService,
    private readonly cardService: ClickCardService,
  ) {}

  /** Customer: get Click payment URL for their order. */
  @Get('orders/:id/url')
  getPaymentUrl(@Param('id') id: string, @Request() req: any) {
    return this.clickService.getPaymentUrl(id, req.user.sub);
  }

  /** Customer: pay for an order with a previously saved card — no redirect. */
  @Post('orders/:id/pay-with-card')
  @HttpCode(HttpStatus.OK)
  payWithCard(
    @Param('id') id: string,
    @Body() dto: PayWithCardDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.cardService.payOrderWithCard(user.sub, id, dto.cardId);
  }

  @Public()
  @Post('prepare')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'application/json')
  prepare(@Body() dto: ClickWebhookDto) {
    return this.clickService.prepare(dto);
  }

  @Public()
  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'application/json')
  complete(@Body() dto: ClickWebhookDto) {
    return this.clickService.complete(dto);
  }

  /** Click redirects the in-app browser here after payment (CLICK_RETURN_URL). */
  @Public()
  @Get('return')
  @Header('Content-Type', 'text/html; charset=utf-8')
  returnPage() {
    return `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Yaqin Market — to'lov</title>
</head>
<body style="font-family: -apple-system, Roboto, sans-serif; text-align: center; padding-top: 72px; color: #1a1a1a;">
<h2>To'lov qabul qilindi</h2>
<p>Ilovaga qayting — buyurtma holati yangilanadi.</p>
</body>
</html>`;
  }
}
