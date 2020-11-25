import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ShopAuthService } from './shop-auth.service';

@Injectable()
export class ShopJwtStrategy extends PassportStrategy(Strategy, 'shopjwt') {
  constructor(
    configService: ConfigService = new ConfigService(),
    private authService: ShopAuthService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('SHOP_JWT_SECRET')
    });
  }

  async validate(payload: any) {
    if(payload.orderId) {
      const orderState = await this.authService.getCartState(payload.orderId);
      if(!(orderState === 'INCOMPLETE' || payload.cartIsClosed)) {
        let {iat, exp, orderId, ...result} = payload;
        return result;
      }
      let {iat, exp, ...result} = payload;
      return {...result, state: orderState};
    }
    let {iat, exp, ...result} = payload;
    return result;
  }
}