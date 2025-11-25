import {Controller, Get, Post, Body, Param, Query, Put, Delete, UseGuards} from '@nestjs/common';
import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { AuthGuard } from '@nestjs/passport';

@UseGuards(AuthGuard('jwt'))
@Controller('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Get()
  search(
    @Query('search') search = '',
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.patientsService.search(search, +page, +limit);
  }

  @Get('exists')
  exists(
    @Query('documentType') documentType: string,
    @Query('documentNumber') documentNumber: string,
  ) {
    return this.patientsService.existsByDocument(documentType, documentNumber);
  }

  @Post()
  async create(@Body() dto: CreatePatientDto) {
    const patient = await this.patientsService.create(dto);
    return {
      message: 'Paciente creado correctamente.',
      data: patient,
    };
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.patientsService.findOne(+id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdatePatientDto) {
    const patient = await this.patientsService.update(+id, dto);
    return {
      message: 'Paciente actualizado correctamente.',
      data: patient,
    };
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    // patientsService.softDelete ya devuelve message
    return this.patientsService.softDelete(+id);
  }

  @Delete(':id/hard')
  hardRemove(@Param('id') id: string) {
    return this.patientsService.hardDelete(+id);
  }
}
