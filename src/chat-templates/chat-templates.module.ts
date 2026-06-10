import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChatTemplatesController } from './chat-templates.controller';
import { ChatTemplate } from './entities/chat-template.entity';
import { ChatTemplatesService } from './chat-templates.service';

@Module({
  imports: [TypeOrmModule.forFeature([ChatTemplate])],
  controllers: [ChatTemplatesController],
  providers: [ChatTemplatesService],
  exports: [ChatTemplatesService],
})
export class ChatTemplatesModule {}
