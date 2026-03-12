import { Module } from '@nestjs/common';
import { DbAdminController } from './db-admin.controller';
import { DbAdminService } from './db-admin.service';
import { AdminBackupsController } from './admin-backups.controller';
import { AdminBackupsService } from './admin-backups.service';

@Module({
  controllers: [DbAdminController, AdminBackupsController],
  providers: [DbAdminService, AdminBackupsService],
})
export class DbAdminModule {}
