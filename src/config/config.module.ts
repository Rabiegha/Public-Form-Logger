import { Global, Module } from '@nestjs/common';
import { loadConfig, AppConfig } from './app-config';

export const APP_CONFIG = 'APP_CONFIG';

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadConfig(),
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
