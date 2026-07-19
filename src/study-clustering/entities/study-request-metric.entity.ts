import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Study } from '../../studies/entities/study.entity';

@Entity({ name: 'study_request_metrics', schema: 'operativo' })
@Unique(['studyId', 'periodMonth'])
export class StudyRequestMetric {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Study, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'study_id' })
  study: Study;

  @Column({ name: 'study_id' })
  studyId: number;

  @Column({ type: 'date', name: 'period_month' })
  periodMonth: string;

  @Column({ type: 'int', name: 'request_count', default: 0 })
  requestCount: number;

  @Column({ name: 'is_synthetic', default: false })
  isSynthetic: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
