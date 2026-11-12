import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { FmpCallbackController, FmpCallbackGuard, FmpController } from './fmp.controller';
import { FmpService } from './fmp.service';

@Module({
  imports: [PrismaModule, AccountsModule, SettingsModule],
  controllers: [FmpController, FmpCallbackController],
  providers: [FmpService, FmpCallbackGuard],
  exports: [FmpService],
})
export class FmpModule {}
