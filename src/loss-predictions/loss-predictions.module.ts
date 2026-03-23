import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Study } from 'src/studies/entities/study.entity';
import { LossHistory } from './entities/loss-history.entity';
import { LossPredictionsController } from './loss-predictions.controller';
import { LossPredictionsService } from './loss-predictions.service';

@Module({
  imports: [TypeOrmModule.forFeature([LossHistory, Study])],
  controllers: [LossPredictionsController],
  providers: [LossPredictionsService],
  exports: [LossPredictionsService],
})
export class LossPredictionsModule {}
