import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { RecalculateStudyClusteringDto } from './dto/recalculate-study-clustering.dto';
import { UpdateStudyClusterProfileDto } from './dto/update-study-cluster-profile.dto';
import { StudyClusteringService } from './study-clustering.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin)
@Controller('study-clustering')
export class StudyClusteringController {
  constructor(
    private readonly studyClusteringService: StudyClusteringService,
  ) {}

  @Get('analysis')
  getLatestAnalysis() {
    return this.studyClusteringService.getLatestAnalysis();
  }

  @Post('recalculate')
  recalculate(@Body() dto: RecalculateStudyClusteringDto) {
    return this.studyClusteringService.recalculate(dto);
  }

  @Patch('profiles/:profileId')
  updateProfileDisplayName(
    @Param('profileId', ParseIntPipe) profileId: number,
    @Body() dto: UpdateStudyClusterProfileDto,
  ) {
    return this.studyClusteringService.updateProfileDisplayName(profileId, dto);
  }
}
