import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
//import { SystemModule } from './system/system.module';
import { ShopModule } from './shop/shop.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'static','assets'),
      serveRoot: '/assets',
      renderPath: '*',
      exclude: ['/shop*','/system*'],
    }),
    JwtModule.register({}),
    //SystemModule,
    ShopModule,
  ],
  /*controllers: [AppController],
  providers: [AppService],*/
})
export class AppModule {}
