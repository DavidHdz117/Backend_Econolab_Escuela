import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { RestoreBackupDto } from './dto/restore-backup.dto';
import { AdminBackupsService } from './admin-backups.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin)
@Controller('admin/backups')
export class AdminBackupsController {
  constructor(private readonly backupsService: AdminBackupsService) {}

  @Post('create')
  createBackup() {
    return this.backupsService.createBackup();
  }

  @Post('table/create')
  createTableBackup(@Body() dto: { tableName?: string }) {
    return this.backupsService.createTableBackup(dto.tableName ?? '');
  }

  @Get()
  listBackups() {
    return this.backupsService.listBackups();
  }

  @Get('jobs')
  listJobs() {
    return this.backupsService.listJobs();
  }

  @Get('table')
  listTableBackups() {
    return this.backupsService.listTableBackups();
  }

  @Post('restore')
  restoreBackup(@Body() dto: RestoreBackupDto) {
    return this.backupsService.restoreBackup(dto.fileName);
  }
}
