import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../auth/role.enum';
import { ContactService } from './contact.service';
import { CreateContactDto } from './dto/contact.dto';

@ApiTags('contact')
@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  // Public: a visitor leaves their name/phone/message on the landing page.
  @Public()
  @Post()
  create(@Body() dto: CreateContactDto, @Ip() ip: string) {
    return this.contact.create(dto, ip);
  }
}

@ApiBearerAuth()
@ApiTags('admin-contact')
@UseGuards(RolesGuard)
@Roles(Role.Admin)
@Controller('admin/contact')
export class AdminContactController {
  constructor(private readonly contact: ContactService) {}

  @Get()
  list() {
    return this.contact.list();
  }

  @Get('unread-count')
  unread() {
    return this.contact.unreadCount();
  }

  @Patch(':id/read')
  markRead(@Param('id', ParseUUIDPipe) id: string) {
    return this.contact.markRead(id);
  }
}
