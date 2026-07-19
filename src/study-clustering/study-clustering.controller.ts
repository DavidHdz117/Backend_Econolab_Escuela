import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { QueryStudyClusteringDto } from './dto/query-study-clustering.dto';
import { StudyClusteringService } from './study-clustering.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin)
@Controller('study-clustering')
export class StudyClusteringController {
  constructor(
    private readonly studyClusteringService: StudyClusteringService,
  ) {}

  @Get('analysis')
  analyze(@Query() query: QueryStudyClusteringDto) {
    return this.studyClusteringService.analyze(query);
  }
}
