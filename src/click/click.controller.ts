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

import { Public } from '../auth/decorators/public.decorator';
import { ClickWebhookDto } from './click-webhook.dto';
import { ClickService } from './click.service';

@Controller('click')
export class ClickController {
  private readonly logger = new Logger(ClickController.name);

  constructor(private readonly clickService: ClickService) {}

  /** Customer: get Click payment URL for their order. */
  @Get('orders/:id/url')
  getPaymentUrl(@Param('id') id: string, @Request() req: any) {
    return this.clickService.getPaymentUrl(id, req.user.sub);
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
}
