import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { ErpModule } from '../erp/erp.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WarroomController } from './warroom.controller';
import { WarroomSyncService } from './warroom-sync.service';

@Module({
  imports: [PrismaModule, AccountsModule, ErpModule],
  controllers: [WarroomController],
  providers: [WarroomSyncService],
  exports: [WarroomSyncService],
})
export class WarroomModule {}
