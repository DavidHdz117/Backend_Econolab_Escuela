import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { CreateLossHistoryDto } from './dto/create-loss-history.dto';
import { PredictLossDto } from './dto/predict-loss.dto';
import { QueryLossHistoryDto } from './dto/query-loss-history.dto';
import { LossPredictionsService } from './loss-predictions.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin)
@Controller('loss-predictions')
export class LossPredictionsController {
  constructor(
    private readonly lossPredictionsService: LossPredictionsService,
  ) {}

  @Get('studies')
  listStudies() {
    return this.lossPredictionsService.listStudies();
  }

  @Get('supplies')
  listSupplies(@Query('studyId') studyId?: string) {
    return this.lossPredictionsService.listSupplies(
      studyId ? Number(studyId) : undefined,
    );
  }

  @Get('history')
  listHistory(@Query() query: QueryLossHistoryDto) {
    return this.lossPredictionsService.listHistory(query);
  }

  @Post('seed-sample')
  seedSampleHistory() {
    return this.lossPredictionsService.seedSampleHistory();
  }

  @Post('history')
  createHistory(@Body() dto: CreateLossHistoryDto) {
    return this.lossPredictionsService.createHistory(dto);
  }

  @Get('predict')
  predict(@Query() query: PredictLossDto) {
    return this.lossPredictionsService.predict(query);
  }
}
