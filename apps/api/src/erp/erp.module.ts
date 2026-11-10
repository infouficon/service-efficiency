import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { LineModule } from '../line/line.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ErpController } from './erp.controller';
import { ErpSyncService } from './erp-sync.service';

@Module({
  imports: [PrismaModule, AccountsModule, LineModule],
  controllers: [ErpController],
  providers: [ErpSyncService],
  exports: [ErpSyncService],
})
export class ErpModule {}
