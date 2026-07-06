import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Shop } from '../shops/entities/shop.entity';
import { ShopStaff } from '../shops/entities/shop-staff.entity';
import { ChatTemplatesController } from './chat-templates.controller';
import { ChatTemplate } from './entities/chat-template.entity';
import { ChatTemplatesService } from './chat-templates.service';

@Module({
  imports: [TypeOrmModule.forFeature([ChatTemplate, Shop, ShopStaff])],
  controllers: [ChatTemplatesController],
  providers: [ChatTemplatesService],
  exports: [ChatTemplatesService],
})
export class ChatTemplatesModule {}
