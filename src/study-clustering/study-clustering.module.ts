import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ServiceOrder,
  ServiceOrderItem,
} from '../services/entities/service-order.entity';
import { StudyDetail } from '../studies/entities/study-detail.entity';
import { Study } from '../studies/entities/study.entity';
import { StudyRequestMetric } from './entities/study-request-metric.entity';
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
    ]),
  ],
  controllers: [StudyClusteringController],
  providers: [StudyClusteringService, StudyClusteringModel],
})
export class StudyClusteringModule {}
