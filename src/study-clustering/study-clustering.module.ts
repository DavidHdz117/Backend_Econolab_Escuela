import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ServiceOrder,
  ServiceOrderItem,
} from '../services/entities/service-order.entity';
import { StudyDetail } from '../studies/entities/study-detail.entity';
import { Study } from '../studies/entities/study.entity';
import { StudyRequestMetric } from './entities/study-request-metric.entity';
import { StudyClusteringAssignment } from './entities/study-clustering-assignment.entity';
import { StudyClusteringProfile } from './entities/study-clustering-profile.entity';
import { StudyClusteringRun } from './entities/study-clustering-run.entity';
import { StudyClusteringModel } from './models/study-clustering.model';
import { StudyClusteringController } from './study-clustering.controller';
import { StudyClusteringService } from './study-clustering.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Study,
      StudyDetail,
      ServiceOrder,
      ServiceOrderItem,
      StudyRequestMetric,
      StudyClusteringRun,
      StudyClusteringProfile,
      StudyClusteringAssignment,
    ]),
  ],
  controllers: [StudyClusteringController],
  providers: [StudyClusteringService, StudyClusteringModel],
  exports: [StudyClusteringService],
})
export class StudyClusteringModule {}
