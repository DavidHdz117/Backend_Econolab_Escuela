import {Controller, Get, Post, Body, Param, Put, Delete, UseGuards,} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ResultsService } from './results.service';
import { CreateStudyResultDto } from './dto/create-study-result.dto';
import { UpdateStudyResultDto } from './dto/update-study-result.dto';

@UseGuards(AuthGuard('jwt'))
@Controller('results')
export class ResultsController {
  constructor(private readonly resultsService: ResultsService) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.resultsService.findOne(+id);
  }

  @Get('service-item/:serviceOrderItemId')
  getOrCreateByServiceItem(
    @Param('serviceOrderItemId') serviceOrderItemId: string,
  ) {
    return this.resultsService.getOrCreateDraftByServiceItem(
      +serviceOrderItemId,
    );
  }

  @Post()
  async create(@Body() dto: CreateStudyResultDto) {
    const result = await this.resultsService.create(dto);
    return {
      message: 'Resultados registrados correctamente.',
      data: result,
    };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateStudyResultDto) {
    const result = await this.resultsService.update(+id, dto);
    return {
      message: 'Resultados actualizados correctamente.',
      data: result,
    };
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.resultsService.softDelete(+id);
  }

  @Delete(':id/hard')
  hardRemove(@Param('id') id: string) {
    return this.resultsService.hardDelete(+id);
  }
}
