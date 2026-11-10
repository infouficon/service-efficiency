import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LineModule } from '../line/line.module';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { OtpService } from './otp.service';
@Module({
  imports: [PrismaModule, LineModule],
  providers: [AccountsService, OtpService],
  controllers: [AccountsController],
  exports: [AccountsService, OtpService],
})
export class AccountsModule {}
