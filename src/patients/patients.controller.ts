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
import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';

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

  @Get('export')
  async exportCsv(@Res() res: Response) {
    const csv = await this.patientsService.exportCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="patients-export.csv"',
    );
    res.send(csv);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  importCsv(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Debes adjuntar un archivo CSV.');
    }

    return this.patientsService.importCsv(file.buffer);
  }

  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file'))
  previewImport(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Debes adjuntar un archivo CSV.');
    }

    return this.patientsService.previewCsv(file.buffer);
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
