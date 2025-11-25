import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StudiesService } from './studies.service';
import { StudiesController } from './studies.controller';
import { Study } from './entities/study.entity';
import { StudyDetail } from './entities/study-detail.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Study, StudyDetail])],
  controllers: [StudiesController],
  providers: [StudiesService],
  exports: [StudiesService],
})
export class StudiesModule {}
