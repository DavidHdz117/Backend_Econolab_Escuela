import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ActiveDto, ActivityDto, CatalogDto } from './school.dto';
import { SchoolService } from './school.service';
import { schoolNotice, schoolPage } from './school-notice';
import { PrivacyPreferencesDto } from '../privacy/privacy.dto';
type Request = { user: { id: string; rol: string } };

@Controller('school')
export class SchoolPublicController {
  @Get('privacy/notice') notice() {
    return schoolNotice();
  }
  @Get('privacy')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  )
  @Header('Cache-Control', 'no-store')
  page() {
    return schoolPage();
  }
  @Get('privacy/account-deletion')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  )
  @Header('Cache-Control', 'no-store')
  deletion() {
    return schoolPage(true);
  }
}
@Controller('school')
@UseGuards(JwtAuthGuard)
export class SchoolController {
  constructor(private readonly school: SchoolService) {}
  @Get('workspace') workspace(@Req() req: Request) {
    return this.school.workspace(req.user.id);
  }
  @Post('catalog') addItem(@Req() req: Request, @Body() dto: CatalogDto) {
    return this.school.addItem(req.user.id, dto);
  }
  @Patch('catalog/:id') active(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActiveDto,
  ) {
    return this.school.setActive(req.user.id, id, dto.active);
  }
  @Post('activities') addActivity(
    @Req() req: Request,
    @Body() dto: ActivityDto,
  ) {
    return this.school.addActivity(req.user.id, dto);
  }
  @Delete('activities/:id') cancel(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.school.cancelActivity(req.user.id, id);
  }
  @Get('cuts') cut(
    @Req() req: Request,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (req.user.rol !== 'admin')
      throw new ForbiddenException(
        'Este resumen requiere el rol administrador.',
      );
    return this.school.cut(req.user.id, from, to);
  }
  @Get('privacy/preferences') preferences(@Req() req: Request) {
    return this.school.preferences(req.user.id);
  }
  @Patch('privacy/preferences') updatePreferences(
    @Req() req: Request,
    @Body() dto: PrivacyPreferencesDto,
  ) {
    return this.school.updatePreferences(req.user.id, dto);
  }
  @Delete('workspace') reset(@Req() req: Request) {
    return this.school.reset(req.user.id);
  }
}
