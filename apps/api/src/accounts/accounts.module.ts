import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SmsModule } from '../sms/sms.module';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { OtpService } from './otp.service';
@Module({
  imports: [PrismaModule, SmsModule],
  providers: [AccountsService, OtpService],
  controllers: [AccountsController],
  exports: [AccountsService, OtpService],
})
export class AccountsModule {}
