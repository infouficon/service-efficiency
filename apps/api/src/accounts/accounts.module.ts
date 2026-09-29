import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
@Module({
  imports: [PrismaModule],
  providers: [AccountsService],
  controllers: [AccountsController],
  exports: [AccountsService],
})
export class AccountsModule {}
