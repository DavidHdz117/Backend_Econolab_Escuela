import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ServiceOrder,
  ServiceOrderItem,
} from '../services/entities/service-order.entity';
import { Patient } from '../patients/entities/patient.entity';
import { Doctor } from '../doctors/entities/doctor.entity';
import { CashCutsController } from './cash-cuts.controller';
import { CashCutsService } from './cash-cuts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ServiceOrder, ServiceOrderItem, Patient, Doctor]),
  ],
  controllers: [CashCutsController],
  providers: [CashCutsService],
})
export class CashCutsModule {}
