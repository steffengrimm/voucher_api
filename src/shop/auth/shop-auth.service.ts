import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/helper/prisma.service';
import { PaymentMethod, OrderState } from '@prisma/client';
import * as jwt from 'jsonwebtoken'
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ShopAuthService {
  private readonly secret : string;

  constructor(
    private prisma: PrismaService,
    configService: ConfigService = new ConfigService()
  ) {
    this.secret = configService.get<string>('SHOP_JWT_SECRET');
  }

  async validateApiKey(apikey: string): Promise<any> {
    const widget = await this.prisma.widget.findOne({where: {identifier: apikey}});
    if (widget)
      return widget;
    return null;
  }

  async issueInitToken(widget: {hash:string,identifier:string}) {
    const payload = {widgetHash: widget.hash};
    return jwt.sign(payload,this.secret,{subject:widget.identifier,expiresIn:'6h',issuer:'ReservisionVoucher'});
  }

  async issueCartToken(widget:{hash:string,identifier:string}, orderId: string, additionals?: {customerCaptured: boolean, paymentMethod?: PaymentMethod}) {
    const payload = additionals ? {widgetHash: widget.hash, orderId: orderId, ...additionals} : {widgetHash: widget.hash, orderId: orderId};
    return jwt.sign(payload,this.secret,{subject:widget.identifier,expiresIn:'6h',issuer:'ReservisionVoucher'});
  }

  async issueClosedToken(widget:{hash:string,identifier:string}, orderId: string) {
    const payload = {widgetHash: widget.hash, orderId: orderId, cartIsClosed: true}
    return jwt.sign(payload,this.secret,{subject:widget.identifier,expiresIn:'60m',issuer:'ReservisionVoucher'});
  }

  async getCartState(cartId: string) : Promise<OrderState> {
    let result = await this.prisma.order.findOne({where: {id: cartId},select: {state:true}});
    return result?.state;
  }

  async decompileJWT(_jwt: string) : Promise<any> {
    return new Promise((resolve, reject) => jwt.verify(_jwt,this.secret, (err, decoded) => {
      if(err)
        reject(err);
      else
        resolve(decoded);
    }));
  }
}