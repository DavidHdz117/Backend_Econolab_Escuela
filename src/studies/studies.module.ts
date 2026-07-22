import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StudiesService } from './studies.service';
import { StudiesController } from './studies.controller';
import { PublicStudiesController } from './public-studies.controller';
import { PublicBrandController } from './public-brand.controller';
import { Study } from './entities/study.entity';
import { StudyDetail } from './entities/study-detail.entity';
import { StudyEstimationModel } from './models/study-estimation.model';

@Module({
  imports: [TypeOrmModule.forFeature([Study, StudyDetail])],
  controllers: [
    StudiesController,
    PublicStudiesController,
    PublicBrandController,
  ],
  // Aqui Nest registra la clase del modelo para poder usarla en StudiesService.
  providers: [StudiesService, StudyEstimationModel],
  exports: [StudiesService],
})
export class StudiesModule {}
