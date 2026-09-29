import { AccountsModule } from './accounts/accounts.module';
import { ProductsModule } from './products/products.module';
import { SessionsModule } from './sessions/sessions.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/environment';
import { HealthController } from './health.controller';

@Module({
  imports: [
    AccountsModule,
    ProductsModule,
    SessionsModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === 'production'
          ? '.env'
          : ['.env.development', '.env'],
      validate: validateEnvironment,
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
