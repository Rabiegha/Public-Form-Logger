import { Module } from '@nestjs/common';
import { AttendeeApiClient } from './attendee-api.client';
import { ConfigModule } from '../../config/config.module';

@Module({
  imports: [ConfigModule],
  providers: [AttendeeApiClient],
  exports: [AttendeeApiClient],
})
export class AttendeeModule {}
