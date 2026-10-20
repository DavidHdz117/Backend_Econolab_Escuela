import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/roles.enum';
import { RolesGuard } from '../common/guards/roles.guard';
import { CashCutsService } from './cash-cuts.service';
import { CashCutQueryDto } from './dto/cash-cut-query.dto';

@Controller('cash-cuts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin)
export class CashCutsController {
  constructor(private readonly cuts: CashCutsService) {}

  @Get()
  getReport(@Query() query: CashCutQueryDto) {
    return this.cuts.getReport(query);
  }
}
