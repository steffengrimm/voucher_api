import {ExecutionContext,Injectable,UnauthorizedException,ForbiddenException, CanActivate} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { SetMetadata } from '@nestjs/common';
import { OrderState } from '@prisma/client';
  
@Injectable()
export class ShopAuthGuard extends AuthGuard('shopjwt'){}

@Injectable()
export class CartStateGuard implements CanActivate {
  constructor(private reflector: Reflector){}

  canActivate(context: ExecutionContext): boolean {
    const cartState = this.reflector.get<string[]>('cartState', context.getHandler());
    const request = context.switchToHttp().getRequest();
    console.log(cartState,request.user.state);
    if (!cartState)
      return true
    return cartState.includes(request.user.state);
  }
}

export const CartState = (...cartState: OrderState[]) => SetMetadata('cartState', cartState);