import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FmpController } from './fmp.controller';
import { FmpService } from './fmp.service';

@Module({
  imports: [PrismaModule, AccountsModule],
  controllers: [FmpController],
  providers: [FmpService],
  exports: [FmpService],
})
export class FmpModule {}
