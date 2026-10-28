import { AccountsModule } from './accounts/accounts.module';
import { ErpModule } from './erp/erp.module';
import { WarroomModule } from './warroom/warroom.module';
import { CategoriesModule } from './categories/categories.module';
import { SmsModule } from './sms/sms.module';
import { PaymentsModule } from './payments/payments.module';
import { PosModule } from './pos/pos.module';
import { ProductsModule } from './products/products.module';
import { QueueModule } from './queue/queue.module';
import { SettingsModule } from './settings/settings.module';
import { SessionsModule } from './sessions/sessions.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/environment';
import { HealthController } from './health.controller';

@Module({
  imports: [
    AccountsModule,
    ErpModule,
    WarroomModule,
    ProductsModule,
    CategoriesModule,
    SmsModule,
    PaymentsModule,
    PosModule,
    QueueModule,
    SettingsModule,
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
