import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ErpController, StockFmpController } from './erp.controller';
import { ErpSyncService } from './erp-sync.service';
import { FmpUnitsService } from './fmp-units.service';

@Module({
  imports: [PrismaModule, AccountsModule],
  controllers: [ErpController, StockFmpController],
  providers: [ErpSyncService, FmpUnitsService],
  exports: [ErpSyncService],
})
export class ErpModule {}
