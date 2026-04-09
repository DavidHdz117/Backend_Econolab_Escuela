import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

export function IsNotInFutureDate(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isNotInFutureDate',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (value == null || value === '') {
            return true;
          }

          const date =
            value instanceof Date ? value : new Date(String(value).trim());

          if (Number.isNaN(date.getTime())) {
            return false;
          }

          return date.getTime() <= Date.now();
        },
        defaultMessage(args?: ValidationArguments) {
          return `${args?.property ?? 'La fecha'} no puede estar en el futuro.`;
        },
      },
    });
  };
}
