import { Module } from '@nestjs/common';
import { PrivacyController, OwnAccountController } from './privacy.controller';
import { PrivacyService } from './privacy.service';
import { MobileSchemaService } from './mobile-schema.service';

@Module({
  controllers: [PrivacyController, OwnAccountController],
  providers: [PrivacyService, MobileSchemaService],
})
export class PrivacyModule {}
