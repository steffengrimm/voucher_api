import { Controller, Get, Put, Head, Body, Req, Res, UseGuards, HttpStatus, Post, Patch, Delete, ForbiddenException, Header, Param } from '@nestjs/common';
import { Response, Request } from 'express'
import { ShopService } from './shop.service';
import { AuthGuard } from '@nestjs/passport';
import { ShopAuthService } from './auth/shop-auth.service';
import { ShopAuthGuard, CartState, CartStateGuard } from './auth/shop-auth.guard';
import { DetermineUserDto, PutCustomerDataDto, UpdateMultipleVoucherDto, UserState, VoucherDto } from './shop.dto';
import { PaymentMethodDto } from './settings.dto';
import { PDFService } from 'src/helper/pdf.service';
import { EMailHelper } from 'src/helper/email.helper';

@Controller('shop')
export class ShopController {
  constructor(
    private readonly authService: ShopAuthService,
    private readonly shopHelper: ShopService,
    private readonly pdfHelper: PDFService,
    //private readonly prisma: PrismaService,
    private readonly mailService: EMailHelper
  ) {}

  @UseGuards(AuthGuard('localapikey'))
  @Head("init")
  async initialize(@Req() req, @Res() res: Response) {
    res.setHeader('X-Authorization', await this.authService.issueInitToken({hash: req.user.id, identifier: req.user.identifier}));
    res.sendStatus(HttpStatus.OK);
  }

  @UseGuards(ShopAuthGuard)
  @Head("reinit")
  async reinitialize(@Req() req, @Res() res: Response) {
    const widgetHash = req.user.widgetHash as string;
    const widgetIdentifier = req.user.sub as string; //subject
    const orderId = req.user.orderId as string;
    const customerCaptured = req.user.customerCaptured;
    const paymentMethod = req.user.paymentMethod;//evtl doch weglassen! -> Nutzer immer zurücksetzen auf PaymentOptions-Seite
    //console.log("reinit",widgetId,orderId);
    console.log(req.user);
    if(orderId) {
      if(req.user.state === 'INCOMPLETE')
        res.setHeader('X-Authorization', await this.authService.issueCartToken({hash:widgetHash,identifier:widgetIdentifier}, orderId, {customerCaptured: customerCaptured, paymentMethod: paymentMethod}))
    } else
      res.setHeader('X-Authorization', await this.authService.issueInitToken({hash:widgetHash,identifier:widgetIdentifier}));
    res.sendStatus(HttpStatus.OK);
  }

  @UseGuards(ShopAuthGuard)
  @Get('widgetInfo')
  async getWidgetInfo(@Req() req) {
    const widgetHash = req.user.widgetHash as string;
    return await this.shopHelper.getWidgetInfo(widgetHash);
  }

  @UseGuards(ShopAuthGuard)
  @Get('config')
  async getConfig(@Req() req) {
    const widgetHash = req.user.widgetHash as string;
    return await this.shopHelper.getConfiguration(widgetHash);
  }

  @UseGuards(ShopAuthGuard)
  @Get('catalog')
  async getLayouts(@Req() req) {
    const widgetHash = req.user.widgetHash as string;
    /*let [categories,products,extraGroups] = await Promise.all([
      this.shopHelper.getCategoriesForCatalog(widgetHash),
      this.shopHelper.getProductsForCatalog(widgetHash),
      this.shopHelper.getExtrasForCatalog(widgetHash)
    ]);
    return {categories: categories, products: products, extraGroups: extraGroups};*/
    return this.shopHelper.getLayoutsForCatalog(widgetHash);
  }

  @UseGuards(ShopAuthGuard)
  @Put('orderSettings')
  async upsertOrder(@Req() req, @Res() res: Response) {
    let orderId = req.user.orderId as string;
    const widgetHash = req.user.widgetHash as string;
    const widgetIdentifier = req.user.sub as string; //subject
    try {
      if(!orderId) {
        console.log("create order");
        const order = await this.shopHelper.createOrder(widgetHash);
        orderId = order.id;
        res.setHeader('X-Authorization', await this.authService.issueCartToken({hash:widgetHash,identifier:widgetIdentifier}, orderId));
      } else {
        const order = await this.shopHelper.getOrder(orderId);
        if(order.state !== 'INCOMPLETE')
          throw new ForbiddenException();
        console.log("existing order")
      }
      res.status(HttpStatus.OK).send([]);
    } catch(e) {
      throw e;
    }
  }

  
  @UseGuards(ShopAuthGuard, CartStateGuard)
  @CartState('INCOMPLETE')
  @Get('customerData')
  async retrieveOrder(@Req() req) {
    const orderId = req.user.orderId as string;
    let result = await this.shopHelper.getCustomerData(orderId);
    return {emailAddress: result.email};
    //return {addressData: JSON.parse(result.shippingAddress), area: result.area, annotations: result.annotations, orderType: result.orderType, expectedDeliveryTime: result.expectedDeliveryTime};
  }

  @UseGuards(ShopAuthGuard, CartStateGuard)
  @CartState('INCOMPLETE')
  @Put('cartItem')
  async postCartItem(@Req() req, @Body() body: VoucherDto, @Res() res: Response) {
    const widgetHash = req.user.widgetHash as string;
    const widgetIdentifier = req.user.sub as string; //subject
    const orderId = req.user.orderId as string;
    try {
      let result = await this.shopHelper.upsertTempVoucher(widgetHash, orderId, body);
      res.setHeader('X-Authorization', await this.authService.issueCartToken({hash:widgetHash, identifier: widgetIdentifier}, orderId));
      res.status(HttpStatus.CREATED).send(result);
    } catch(e) {
      throw e;
    }
  }

  /*@UseGuards(ShopAuthGuard, CartStateGuard)
  @CartState('INCOMPLETE')
  @Patch('cartItem')
  async updateCartItem(@Req() req, @Body() body: UpdateMultipleVoucherDto, @Res() res: Response) {
    const widgetHash = req.user.widgetHash as string;
    const widgetIdentifier = req.user.sub as string; //subject
    const orderId = req.user.orderId as string;
    try {
      let result = await this.shopHelper.updateMultipleVouchers(orderId, body);
      res.setHeader('X-Authorization', await this.authService.issueCartToken({hash:widgetHash, identifier: widgetIdentifier}, orderId));
      res.status(HttpStatus.OK).send(result);
    } catch(e) {
      throw e;
    }
  }*/

  @UseGuards(ShopAuthGuard, CartStateGuard)
  @CartState('INCOMPLETE')
  @Get('cartItem')
  async getCartItems(@Req() req) {
    const orderId = req.user.orderId as string;
    return await this.shopHelper.getTemporaryVouchers(orderId);
  }

  @UseGuards(ShopAuthGuard, CartStateGuard)
  @CartState('INCOMPLETE')
  @Delete('cartItem')
  async deleteCartItem(@Req() req) {
    const itemId = req.query?.itemId as string;
    const orderId = req.user.orderId as string;
    try {
      await this.shopHelper.deleteTemporaryVoucher(itemId, orderId);
      return;
    } catch(e) {
      throw e;
    }
  }

  @UseGuards(ShopAuthGuard)
  @Post('findUser')
  async findUser(@Req() req, @Body() body: DetermineUserDto, @Res() res: Response) {
    const widgetHash = req.user.widgetHash as string;
    try {
      let response = new DetermineUserDto();
      response.emailAddress = body.emailAddress;

      response.userState = UserState[await this.shopHelper.findCustomerByEmail(widgetHash,body.emailAddress)] as keyof typeof UserState;
      res.status(HttpStatus.OK).send(response);
    } catch(e) {
      throw e;
    }
  }

  @UseGuards(ShopAuthGuard, CartStateGuard)
  @CartState('INCOMPLETE')
  @Put('customerData')
  async putCustomerData(@Req() req, @Body() body : PutCustomerDataDto, @Res() res: Response) {
    const widgetHash = req.user.widgetHash as string;
    const widgetIdentifier = req.user.sub as string; //subject
    const orderId = req.user.orderId as string;
    try {
      let response = new DetermineUserDto();
      response.emailAddress = body.loginData.checkEmail;

      response.userState = UserState[await this.shopHelper.putCustomerData(widgetHash, orderId, body)] as keyof typeof UserState;
      res.setHeader('X-Authorization', await this.authService.issueCartToken({hash:widgetHash,identifier:widgetIdentifier}, orderId, {customerCaptured: true}));
      res.status(HttpStatus.OK).send(response);
    } catch(e) {
      throw e;
    }
  }

  /*@UseGuards(ShopAuthGuard, CartStateGuard)
  @CartState('INCOMPLETE')
  @Put('additionalAddress')
  async putAdditionalAddress(@Req() req, @Body() body : AdditionalAddressDto) {
    const orderId = req.user.orderId as string;
    await this.shopHelper.putAdditionalAddress(orderId, body);
    return;
  }*/
  
  @UseGuards(ShopAuthGuard, CartStateGuard)
  @CartState('INCOMPLETE')
  @Put('paymentMethod')
  async putPaymentMethod(@Req() req, @Body() body: PaymentMethodDto, @Res() res: Response) {
    const widgetHash = req.user.widgetHash as string;
    const widgetIdentifier = req.user.sub as string; //subject
    const orderId = req.user.orderId as string;
    const customerCaptured = req.user.customerCaptured;
    try {
      let paymentMethod = await this.shopHelper.putPaymentMethod(widgetHash, orderId, body);
      res.setHeader('X-Authorization', await this.authService.issueCartToken({hash:widgetHash,identifier:widgetIdentifier}, orderId, {customerCaptured:customerCaptured,paymentMethod:paymentMethod}));
      res.status(HttpStatus.OK).send({paymentMethod: paymentMethod} as PaymentMethodDto);
    } catch(e) {
      throw e;
    }
  }

  @UseGuards(ShopAuthGuard, CartStateGuard)
  @CartState('INCOMPLETE')
  @Get('paymentIntent')
  async getPaymentIntent(@Req() req) {
    const widgetHash = req.user.widgetHash as string;
    const orderId = req.user.orderId as string;
    try {
      let paymentIntent = await this.shopHelper.getPaymentIntent(widgetHash, orderId);
      return {paymentIntent: paymentIntent};
    } catch(e) {
      throw e;
    }
  }

  @UseGuards(ShopAuthGuard, CartStateGuard)
  @CartState('INCOMPLETE')
  @Delete('closeCart')
  async closeCart(@Req() req, @Res() res: Response) {
    const widgetHash = req.user.widgetHash as string;
    const widgetIdentifier = req.user.sub as string; //subject
    const orderId = req.user.orderId as string;
    try {
      const wasSuccessful = await this.shopHelper.closeCart(widgetHash, orderId);
      if(wasSuccessful) {
        this.mailService.sendConfirmationMail(orderId);
      //PubSubSingleton.getInstance().publish('orderModified',{orderModified:order});
        res.setHeader('X-Authorization', await this.authService.issueClosedToken({hash:widgetHash,identifier:widgetIdentifier}, orderId));
        return res.status(HttpStatus.OK).send({});
      } else {
        return res.status(HttpStatus.EXPECTATION_FAILED).send({});
      }
    } catch(e) {
      throw e;
    }
  }

  /*
  @UseGuards(ShopAuthGuard, CartStateGuard)
  @CartState('PENDING','ACCEPTED','DECLINED')
  @Get('orderState')
  async orderState(@Req() req) {
    const orderId = req.user.orderId as string;
    if(orderId)
      return await this.shopHelper.getCartState(orderId);
    throw new ForbiddenException();
  }*/

  @UseGuards(ShopAuthGuard)
  @Get('disclaimer')
  async getDisclaimer(@Req() req) {
    const widgetHash = req.user.widgetHash as string;
    return await this.shopHelper.getImprint(widgetHash,'DISCLAIMER');
  }

  @UseGuards(ShopAuthGuard)
  @Get('privacy')
  async getPrivacy(@Req() req) {
    const widgetHash = req.user.widgetHash as string;
    return await this.shopHelper.getImprint(widgetHash,'PRIVACY');
  }

  @UseGuards(ShopAuthGuard)
  @Get('agb')
  async getAGB(@Req() req) {
    const widgetHash = req.user.widgetHash as string;
    return await this.shopHelper.getImprint(widgetHash,'AGB');
  }

  @CartState('COMPLETED')
  @Get('pdf/:jwt')
  @Header('content-type', 'application/pdf')
  @Header('content-Disposition', 'inline; filename="gutschein.pdf"')
  async test(@Param('jwt') jwt: string, @Res() res) {
    try {
      const token = await this.authService.decompileJWT(jwt)
      if(token.cartIsClosed) {
        const orderId = token.orderId;
        const bytes = await this.pdfHelper.generatePDF(orderId);
        return res.send(bytes);
      }
    } catch(e) {
    } finally {
      return res.sendStatus(HttpStatus.UNAUTHORIZED)
    }
  }

  @Get('mail')
  async mail() {
      //return this.mailService.acceptMail();
      return this.mailService.mailTemplateForOrder('ckhxjigm5047844ujou3wwcz0');
      //this.mailService.sendConfirmationMail('ckhul25rl0010a8ujn2jiqlfq');
      return;
  }/*

  @Get('preview')
  async preview() {
    return this.pdfHelper.createPDFPreview('ckhdggtuw000001l3d8v0ca28','ckheylq0b000001mlfnnsfmth');
  }

  /*@Get('testMail')
  async testMail(@Req() req, @Res() res: Response) {
    try {
      let out = this.mailServivce.testMJML();
      return res.status(200).send(out);
    } catch(e) {
      return res.status(200).send(e)
    }
  }*/
}
