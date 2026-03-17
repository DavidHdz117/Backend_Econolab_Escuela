import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { DoctorsService } from './doctors.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';

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

  @Get('export')
  async exportCsv(@Res() res: Response) {
    const csv = await this.doctorsService.exportCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="doctors-export.csv"',
    );
    res.send(csv);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  importCsv(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Debes adjuntar un archivo CSV.');
    }

    return this.doctorsService.importCsv(file.buffer);
  }

  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file'))
  previewImport(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Debes adjuntar un archivo CSV.');
    }

    return this.doctorsService.previewCsv(file.buffer);
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
