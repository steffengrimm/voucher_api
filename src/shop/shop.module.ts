import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ShopController } from './shop.controller';
import { ShopService } from './shop.service';
import { PrismaService } from 'src/helper/prisma.service';
import { APP_GUARD } from '@nestjs/core';
import { CartStateGuard } from './auth/shop-auth.guard';
import { PaymentHelper } from 'src/helper/payment.helper';
import { PDFService } from 'src/helper/pdf.service';
//import { OrderHelper } from 'src/system/helper/order.helper';
//import { PaymentHelper } from 'src/system/helper/payment.helper';
import { EMailHelper } from 'src/helper/email.helper';

@Module({
    imports: [
        AuthModule
    ],
    controllers: [ShopController],
    providers: [
        ShopService,
        PrismaService,
        PDFService,
        //OrderHelper,
        PaymentHelper,
        EMailHelper,
        //ReimannsEckService
    ]
})
export class ShopModule {
    
}
