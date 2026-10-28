import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SmsWebhookController } from './sms-webhook.controller';
import { SmsService } from './sms.service';

@Module({
  imports: [PrismaModule],
  controllers: [SmsWebhookController],
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
