import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ColorsController } from './colors.controller';
import { ColorsService } from './colors.service';

@Module({
  imports: [AccountsModule, PrismaModule],
  controllers: [ColorsController],
  providers: [ColorsService],
  exports: [ColorsService],
})
export class ColorsModule {}
