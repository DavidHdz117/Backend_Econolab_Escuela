import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DecimalTransformer } from 'src/common/transformers/decimal.transformer';
import { Study, StudyType } from 'src/studies/entities/study.entity';

@Entity({ name: 'loss_history', schema: 'operativo' })
@Index('idx_loss_history_occurred_at', ['occurredAt'])
@Index('idx_loss_history_study', ['studyId'])
@Index('idx_loss_history_supply', ['supplyName'])
@Index('idx_loss_history_study_supply_date', ['studyId', 'supplyName', 'occurredAt'])
export class LossHistory {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Study, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'study_id' })
  study: Study;

  @Column({ name: 'study_id' })
  studyId: number;

  @Column({ type: 'timestamp', name: 'occurred_at' })
  occurredAt: Date;

  @Column({ name: 'study_name_snapshot', length: 200 })
  studyNameSnapshot: string;

  @Column({
    type: 'enum',
    enum: StudyType,
    name: 'study_type_snapshot',
  })
  studyTypeSnapshot: StudyType;

  @Column({ name: 'supply_name', length: 150 })
  supplyName: string;

  @Column({
    name: 'quantity_loss',
    type: 'decimal',
    precision: 12,
    scale: 4,
    transformer: DecimalTransformer,
  })
  quantityLoss: number;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
