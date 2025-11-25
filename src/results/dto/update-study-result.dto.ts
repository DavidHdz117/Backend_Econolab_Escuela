import { PartialType } from '@nestjs/mapped-types';
import { CreateStudyResultDto } from './create-study-result.dto';

export class UpdateStudyResultDto extends PartialType(CreateStudyResultDto) {}
