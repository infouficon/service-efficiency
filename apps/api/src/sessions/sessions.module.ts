import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { FmpModule } from '../fmp/fmp.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { SettingsModule } from '../settings/settings.module';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [PrismaModule, AccountsModule, QueueModule, SettingsModule, FmpModule],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
