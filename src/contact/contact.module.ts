import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  AdminContactController,
  ContactController,
} from './contact.controller';
import { ContactService } from './contact.service';
import { ContactInquiry } from './entities/contact-inquiry.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ContactInquiry])],
  controllers: [ContactController, AdminContactController],
  providers: [ContactService],
})
export class ContactModule {}
