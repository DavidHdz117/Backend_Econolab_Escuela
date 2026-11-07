import { Module } from '@nestjs/common';
import { SchoolController, SchoolPublicController } from './school.controller';
import { SchoolService } from './school.service';
@Module({
  controllers: [SchoolController, SchoolPublicController],
  providers: [SchoolService],
})
export class SchoolModule {}
