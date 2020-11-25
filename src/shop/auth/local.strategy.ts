import { Strategy } from 'passport-localapikey-es6';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ShopAuthService } from './shop-auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: ShopAuthService) {
    super();
  }

  async validate(apikey: string): Promise<any> {
    const user = await this.authService.validateApiKey(apikey);
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }
}