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

  // The webhook bodies are typed as plain records, NOT ClickWebhookDto: the
  // global ValidationPipe (forbidNonWhitelisted) skips non-class body types,
  // and that's deliberate. Click sends undeclared extra fields (observed
  // 2026-07-29: `param2=merchant` on token-sourced payments) and per the Shop
  // API contract a webhook must never get an HTTP 400 — errors are reported
  // in a 200 body via the `error` code. Authenticity is enforced by
  // checkSign() in the service, which fails closed on any missing field.
  @Public()
  @Post('prepare')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'application/json')
  prepare(@Body() body: Record<string, string>) {
    return this.clickService.prepare(body as unknown as ClickWebhookDto);
  }

  @Public()
  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'application/json')
  complete(@Body() body: Record<string, string>) {
    return this.clickService.complete(body as unknown as ClickWebhookDto);
  }

  /**
   * Click redirects the in-app browser here after payment (return_url built
   * per-order in ClickService.buildUrl). This page is a UX convenience only —
   * it never claims success/failure itself, since the redirect isn't the
   * authoritative payment confirmation (prepare/complete is). It just sends
   * the customer straight back into the app, to the order that already
   * renders whatever the real paymentStatus is.
   */
  @Public()
  @Get('return/:orderId')
  @Header('Content-Type', 'text/html; charset=utf-8')
  returnPage(@Param('orderId') orderId: string) {
    const appUrl = `yaqinmarket://orders/${orderId}`;
    return `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="refresh" content="0; url=${appUrl}" />
<title>Yaqin Market — to'lov</title>
</head>
<body style="font-family: -apple-system, Roboto, sans-serif; text-align: center; padding-top: 72px; color: #1a1a1a;">
<h2>Ilovaga qaytilmoqda…</h2>
<p>Buyurtma holati ilovada ko'rsatiladi.</p>
<p><a href="${appUrl}" style="color: #E8392E; font-weight: 700;">Avtomatik o'tmadimi? Shu yerni bosing</a></p>
<script>window.location.replace(${JSON.stringify(appUrl)});</script>
</body>
</html>`;
  }
}
