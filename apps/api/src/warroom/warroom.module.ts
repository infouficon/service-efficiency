import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { ErpModule } from '../erp/erp.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StockSerialController, WarroomController } from './warroom.controller';
import { SerialCheckService } from './serial-check.service';
import { WarroomSyncService } from './warroom-sync.service';

@Module({
  imports: [PrismaModule, AccountsModule, ErpModule],
  controllers: [WarroomController, StockSerialController],
  providers: [WarroomSyncService, SerialCheckService],
  exports: [WarroomSyncService],
})
export class WarroomModule {}
