import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module';
import { PosController, PosKeyGuard } from './pos.controller';

@Module({
  imports: [SessionsModule],
  controllers: [PosController],
  providers: [PosKeyGuard],
})
export class PosModule {}
