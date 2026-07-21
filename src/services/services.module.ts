import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import {
  ServiceOrder,
  ServiceOrderItem,
} from './entities/service-order.entity';
import { Patient } from '../patients/entities/patient.entity';
import { Doctor } from '../doctors/entities/doctor.entity';
import { Study } from '../studies/entities/study.entity';
import { ServiceOutcomePredictionModel } from './models/service-outcome-prediction.model';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ServiceOrder,
      ServiceOrderItem,
      Patient,
      Doctor,
      Study,
    ]),
  ],
  controllers: [ServicesController],
  providers: [ServicesService, ServiceOutcomePredictionModel],
  exports: [ServicesService],
})
export class ServicesModule {}
