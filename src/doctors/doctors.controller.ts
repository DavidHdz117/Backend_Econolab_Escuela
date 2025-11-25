import {Controller, Get, Post, Body, Param, Query, Put, Delete, UseGuards,} from '@nestjs/common';
import { DoctorsService } from './doctors.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { AuthGuard } from '@nestjs/passport';

@UseGuards(AuthGuard('jwt'))
@Controller('doctors')
export class DoctorsController {
  constructor(private readonly doctorsService: DoctorsService) {}

  @Get()
  search(
    @Query('search') search = '',
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.doctorsService.search(search, +page, +limit);
  }

  @Get('exists')
  exists(@Query('licenseNumber') licenseNumber: string) {
    return this.doctorsService.existsByLicense(licenseNumber);
  }

  @Post()
  async create(@Body() dto: CreateDoctorDto) {
    const doctor = await this.doctorsService.create(dto);
    return {
      message: 'Médico creado correctamente.',
      data: doctor,
    };
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.doctorsService.findOne(+id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateDoctorDto) {
    const doctor = await this.doctorsService.update(+id, dto);
    return {
      message: 'Médico actualizado correctamente.',
      data: doctor,
    };
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.doctorsService.softDelete(+id);
  }

  @Delete(':id/hard')
  hardRemove(@Param('id') id: string) {
    return this.doctorsService.hardDelete(+id);
  }
}
