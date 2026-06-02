import { Controller, Get, Param, Query } from '@nestjs/common';
import { StudiesService } from './studies.service';
import { StudyType } from './entities/study.entity';

@Controller('public/studies')
export class PublicStudiesController {
  constructor(private readonly studiesService: StudiesService) {}

  @Get('available')
  listAvailable(
    @Query('search') search = '',
    @Query('type') type?: StudyType,
    @Query('limit') limit = 20,
    @Query('includeDetails') includeDetails?: string,
  ) {
    return this.studiesService.listAvailableForPublic({
      search,
      type,
      limit: +limit,
      includeDetails: includeDetails === 'true',
    });
  }

  @Get('available/:codeOrId')
  findAvailable(
    @Param('codeOrId') codeOrId: string,
    @Query('includeDetails') includeDetails?: string,
  ) {
    return this.studiesService.findAvailableForPublic(
      codeOrId,
      includeDetails !== 'false',
    );
  }
}
