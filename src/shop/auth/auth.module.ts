import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ShopAuthService } from './shop-auth.service';
import { PassportModule } from '@nestjs/passport';
import { LocalStrategy } from './local.strategy';
import { PrismaService } from 'src/helper/prisma.service';
import { JwtModule } from '@nestjs/jwt';
import { ShopJwtStrategy } from './shop-jwt.strategy';

@Module({
  imports: [
    PassportModule.register({defaultStrategy: 'shopjwt'}),
    ConfigModule.forRoot({
      envFilePath: '.env'
    }),
  ],
  providers: [ShopAuthService, LocalStrategy, ShopJwtStrategy, PrismaService],
  exports: [ShopAuthService]
})
export class AuthModule {}
