import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { IsNotInFutureDate } from 'src/common/validators/is-not-in-future-date.validator';
import { PatientGender } from '../entities/patient.entity';

export class CreatePatientDto {
  @IsString({ message: 'El nombre debe ser una cadena de texto.' })
  @Length(1, 100, {
    message: 'El nombre es obligatorio y maximo de 100 caracteres.',
  })
  firstName: string;

  @IsOptional()
  @IsString({ message: 'El apellido paterno debe ser una cadena de texto.' })
  @Length(1, 100, {
    message: 'El apellido paterno es obligatorio y maximo de 100 caracteres.',
  })
  lastName: string;

  @IsOptional()
  @IsString({ message: 'El apellido materno debe ser una cadena de texto.' })
  @Length(1, 100, {
    message: 'El apellido materno debe tener maximo 100 caracteres.',
  })
  middleName?: string;

  @IsEnum(PatientGender, {
    message: 'El sexo es invalido. Valores permitidos: male, female, other.',
  })
  gender: PatientGender;

  @IsDateString(
    {},
    {
      message: 'La fecha de nacimiento debe tener formato valido (YYYY-MM-DD).',
    },
  )
  @IsNotInFutureDate({
    message: 'La fecha de nacimiento no puede estar en el futuro.',
  })
  birthDate: string;

  @IsOptional()
  @IsString({ message: 'El telefono debe ser una cadena de texto.' })
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'El correo electronico no tiene un formato valido.' })
  email?: string;

  @IsOptional()
  @IsString({ message: 'La direccion debe ser una cadena de texto.' })
  addressLine?: string;

  @IsOptional()
  @IsString({ message: 'El campo "entre calles" debe ser una cadena de texto.' })
  addressBetween?: string;

  @IsOptional()
  @IsString({ message: 'La ciudad debe ser una cadena de texto.' })
  addressCity?: string;

  @IsOptional()
  @IsString({ message: 'El estado debe ser una cadena de texto.' })
  addressState?: string;

  @IsOptional()
  @IsString({ message: 'El codigo postal debe ser una cadena de texto.' })
  addressZip?: string;

  @IsOptional()
  @IsString({ message: 'El tipo de documento debe ser una cadena de texto.' })
  documentType?: string;

  @IsOptional()
  @IsString({ message: 'El numero de documento debe ser una cadena de texto.' })
  documentNumber?: string;
}
