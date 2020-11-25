import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from 'src/helper/prisma.service';
import { VoucherDto, UpdateVoucherDto, UpdateMultipleVoucherDto, UserState, PutCustomerDataDto } from './shop.dto';
import { validate } from 'class-validator';
import { PaymentHandlerDto, PaymentMethodSelection, PaymentMethodDto } from './settings.dto';
import { Address, PaymentMethod, Voucher } from '@prisma/client';
import Stripe from 'stripe'
import { PaymentHelper } from '../helper/payment.helper';

@Injectable()
export class ShopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentHelper: PaymentHelper,
  ) {}

  async getWidgetInfo(widgetId: string) {
    const {blockedInfo, infoText, ...rest} = await this.prisma.widget.findOne({
      where: {
        id: widgetId
      },
      select: {
        infoText: {
          select: {
            text: true
          }
        },
        hidden: true,
        blocked: true,
        blockedInfo: {
          select: {
            text: true
          }
        },
        hasCustomCSS: true
      }
    })

    return {...rest, blockedInfo: blockedInfo?.text ?? "", infoText: infoText?.text ?? ""};
  }

  async getConfiguration(widgetId: string) { //TODO: add Location-Settings
    let addressData : {location: {name: string, address: Address, socialMedia?: {}}} = await this.prisma.widget.findOne({
      where: {
        id: widgetId,
      },select: {
        location: {
          select: {
            name: true,
            address: true
          }
        }
      }
    });

    const [rawConfig,paymentMethodsAndKeys] = await Promise.all([
      await this.prisma.locationSetting.findMany({
        where: {
          location: {
            widgets: {
              some: {
                id: widgetId
              }
            }
          },
          OR: [
            {settingType: 'PRESETVALUES'},{settingType:'VALUEBOUNDARIES'},{settingType:'SOCIALMEDIA'}
          ]
        },
        select: {
          settingType: true,
          value: true
        }
      }),
      this.paymentHelper.getPaymentMethodsAndKeys(widgetId),
    ]);

    let appConfig : {
      paymentKeys?: PaymentHandlerDto,
      paymentMethods: PaymentMethodSelection,
      presetValues: number[],
      valueBoundaries: {min:number,max:number}
    } = {
      paymentMethods: [],
      presetValues: [],
      valueBoundaries: null
    };

    if(paymentMethodsAndKeys.paymentKeys) {
      appConfig.paymentMethods = paymentMethodsAndKeys.paymentMethods;
      appConfig.paymentKeys = {};
      Object.keys(paymentMethodsAndKeys.paymentKeys).forEach(k => {
        appConfig.paymentKeys[k] = paymentMethodsAndKeys.paymentKeys[k].publicKey;
      });
    }

    rawConfig.forEach(config => {
      switch(config.settingType) {
        case 'PRESETVALUES':
          appConfig.presetValues = JSON.parse(config.value)
          break;
        case 'VALUEBOUNDARIES':
          try {
            const [min, max] = JSON.parse(config.value);
            appConfig.valueBoundaries = {min: min, max: max};
          } catch(e){}
          break;
        case 'SOCIALMEDIA':
          try {
            const media = JSON.parse(config.value);
            addressData.location.socialMedia = media;
          } catch(e){}
          break;
      }
    });

    return {...addressData, appConfig};
  }

  async getLayoutsForCatalog(widgetId: string) {
    return await this.prisma.layout.findMany({
      where: {
        location: {
          widgets: {
            some: {
              id: widgetId
            }
          }
        },
        blocked: false,
      },
      select: {
        id: true,
        name: true,
        description: true
      }
    })
  }

  async createOrder(widgetId: string) {
    return await this.prisma.order.create({
      data: {
        state: 'INCOMPLETE',
        widget: {
          connect: {
            id: widgetId
          }
        }
      }
    })
  }

  async getOrder(orderId: string) {
    return await this.prisma.order.findOne({
      where: {
        id: orderId
      }
    });
  }

  async getCustomerData(orderId: string) {
    const result = await this.prisma.order.findOne({
      where: {
        id: orderId
      },
      select : {
        customer: {
          select: {
            email: true,
            firstName: true,
            lastName: true
          }
        }
      }
    })

    return result.customer;
  }

  private async getValueBoundaries(locationId: number) {
    const valueBoundaries = await this.prisma.locationSetting.findOne({
      where: {
        locationId_settingType: {
          locationId: locationId,
          settingType: 'VALUEBOUNDARIES'
        }
      }
    });
    const result : {min: number, max: number} = null;
    if(valueBoundaries) {
      try {
        const [min, max] = JSON.parse(valueBoundaries.value);
        result.min = min;
        result.max = max;
      } catch(e){}
    }
    return result;
  }

  async upsertTempVoucher(widgetId: string, orderId: string, inputDto: VoucherDto & {id?: string}) {
    if(!orderId)
      throw new BadRequestException("no orderId provided");

    let location = await this.prisma.widget.findOne({
      where: {
        id: widgetId
      },
      select: {
        locationId: true
      }
    });

    const [layout, boundaries] = await Promise.all([this.prisma.layout.findFirst({
      where: {
        id: inputDto.layoutId,
        locationId: location.locationId
      }
    }),this.getValueBoundaries(location.locationId)]);

    if(!layout)
      throw new BadRequestException("selected layout is not available");

    if(boundaries) {
      if(inputDto.initialValue < boundaries.min || inputDto.initialValue > boundaries.max)
        throw new BadRequestException("voucher value exceeds boundaries (min: "+boundaries.min+", max: "+boundaries.max+")");
    }

    const quantity = inputDto.quantity ?? 1;

    const upsertData = {
      layout: {
        connect: {
          id: layout.id
        }
      },
      order: {
        connect: {
          id: orderId
        }
      },
      initialValue: inputDto.initialValue,
      quantity: quantity,
      annotations: inputDto.annotations
    };

    await this.prisma.payment.deleteMany({
      where: {
        orderId: orderId
      }
    })

    if(inputDto.id) {
      return await this.prisma.voucherTemp.update({
        where: {
          id: inputDto.id
        },
        data: {
          ...upsertData
        }
      })
    } else {
      return await this.prisma.voucherTemp.create({
        data: {
          ...upsertData
        }
      })
    }
  }

  /**
   * Creates new Vouchers in the given cart based on the input data. The quantity is derived from inputDto
   * @param widgetId id of the accessing widget
   * @param orderId id of the currently active cart
   * @param inputDto data-object to create (multiple) vouchers for the given cart.
   */

  /*async createNewVouchers(widgetId: string, orderId: string, inputDto: VoucherDto) : Promise<VoucherDto[]> {
    if(!orderId)
      throw new BadRequestException("no orderId provided");

    let location = await this.prisma.widget.findOne({
      where: {
        id: widgetId
      },
      select: {
        locationId: true
      }
    })

    const layout = await this.prisma.layout.findFirst({
      where: {
        id: inputDto.layoutId,
        locationId: location.locationId
      }
    })

    if(!layout)
      throw new BadRequestException("selected layout is not available");

    const quantity = inputDto.quantity ?? 1;

    const promises : Promise<any>[] = [];
    
    for(let n = 0; n < quantity; n++) {
      promises.push(this.prisma.voucher.create({
        data: {
          order: {
            connect: {
              id: orderId
            }
          },
          initialValue: inputDto.initialValue,
          annotations: inputDto.annotations,
          layout: {
            connect: {
              id: layout.id
            }
          }
        }
      }));
    }

    return await Promise.all(promises);
  }*/

  /**
   * Updates several vouchers in the given cart
   * @param orderId orderId of the current cart
   * @param inputDto data-object to identify AND update multiple vouchers that belong to the given cart. Identification is done by comparing layouts and initial values
   */

  /*async updateMultipleVouchers(orderId: string, inputDto: UpdateMultipleVoucherDto) : Promise<VoucherDto[]> {
    if(!orderId)
      throw new BadRequestException("no orderId provided");

    let existingVouchers = await this.prisma.voucher.findMany({
      where: {
        layoutId: inputDto.layoutId,
        initialValue: inputDto.initialValue,
        orderId: orderId
      },
      orderBy: {
        id: 'asc'
      }
    });

    if(!existingVouchers.length)
      throw new BadRequestException('vouchers with given layoutId '+inputDto.layoutId+' and initialValue '+inputDto.initialValue+' do not belong to the current order');

    if(inputDto.quantity) {
      if(existingVouchers.length > inputDto.quantity) {
        const deleteVouchers = existingVouchers.slice(inputDto.quantity).map(voucher => voucher.id);
        await this.prisma.voucher.deleteMany({
          where: {
            id: {
              in: deleteVouchers
            }
          }
        });
        existingVouchers = existingVouchers.slice(0,inputDto.quantity);
      } else if(existingVouchers.length < inputDto.quantity) {
        let count = inputDto.quantity - existingVouchers.length;

        const promises : Promise<any>[] = [];
        for(let n = 0; n < count; n++) {
          promises.push(this.prisma.voucher.create({
            data: {
              order: {
                connect: {
                  id: orderId
                }
              },
              initialValue: existingVouchers[0].initialValue,
              annotations: existingVouchers[0].annotations,
              layout: {
                connect: {
                  id: existingVouchers[0].layoutId
                }
              }
            }
          }))
        }
        existingVouchers.push(...await Promise.all(promises));
      }
    }

    let data : any = {};

    if(inputDto.annotations)
      data = {...data, annotations: inputDto.annotations};

    if(inputDto.newValue && inputDto.newValue !== inputDto.initialValue)
      data = {...data, initialValue: inputDto.newValue};

    if(Object.keys(data).length) {
      let batch = await this.prisma.voucher.updateMany({
        where: {
          layoutId: inputDto.layoutId,
          initialValue: inputDto.initialValue,
          orderId: orderId
        },
        data: {
          ...data
        }
      });

      if(batch.count > 0) {
        existingVouchers.map(voucher => {
          if(inputDto.annotations)
            voucher.annotations = inputDto.annotations;
          if(inputDto.newValue && inputDto.newValue !== inputDto.initialValue)
            voucher.initialValue = inputDto.newValue;
          return voucher;
        })
      }
    }

    return existingVouchers.sort((a,b) => a.id < b.id ? -1 : 1);
  }*/

  /*async updateSingleVoucher(orderId: string, inputDto: UpdateVoucherDto) : Promise<VoucherDto> {
    if(!orderId)
      throw new BadRequestException("no orderId provided");

    let existingVouchers = await this.prisma.voucher.findOne({
      where: {
        id: inputDto.itemId
      },
    });

    if(!existingVouchers)
      throw new BadRequestException('voucher with given id '+inputDto.itemId+' does not belong to the current order');

    let data : any = {};

    if(inputDto.annotations)
      data = {...data, annotations: inputDto.annotations};

    if(inputDto.initialValue && inputDto.initialValue !== existingVouchers.initialValue)
      data = {...data, initialValue: inputDto.initialValue};

    if(Object.keys(data).length) {
      return await this.prisma.voucher.update({
        where: {
          id: existingVouchers.id
        },
        data: {
          ...data
        }
      });
    }

    return existingVouchers;
  }*/

  async getTemporaryVouchers(orderId: string) {
    return await this.prisma.voucherTemp.findMany({
      where: {
        orderId: orderId
      }
    })
  }

  async deleteTemporaryVoucher(itemId: string, orderId: string) {
    if(!itemId)
      throw new BadRequestException("no itemId provided");
    if(!orderId)
      throw new BadRequestException("no orderId provided");

    let existing = await this.prisma.voucherTemp.findFirst({
      where: {
        id: itemId,
        orderId: orderId
      }
    });

    if(!existing)
      return;

    try {
      await Promise.all([this.prisma.voucherTemp.delete({
        where: {
          id: itemId
        }
      }),this.prisma.payment.deleteMany({
        where: {
          orderId: orderId
        }
      })]);
      return;
    } catch (e) {
      console.log(`Error while trying to delete voucher with id: ${itemId}`, 'Error Message: ', e)
    }
  }

  private isJsonString(str : string) : boolean {
    try {
      if(str.length) {
        JSON.parse(str);
        return true;
      }
    } catch(e){}
    return false;
  }

  async findCustomerByEmail(widgetId: string, email: string) : Promise<UserState> {
    let result = await this.prisma.customer.findMany({
      where: {
        email: email,
        location: {
          widgets: {
            some: {
              id: widgetId
            }
          }
        }
      },
      select: {
        id: true,
        invoiceData: true
      }
    })

    if(!result.length)
      return UserState.UNKNOWN;
    return this.isJsonString(result[0].invoiceData) ? UserState.COMPLETE : UserState.INVOICEDATAMISSING;
  }

  async putCustomerData(widgetId: string, orderId: string, inputDto: PutCustomerDataDto) : Promise<UserState> {
    if(!orderId)
      throw new BadRequestException("no orderId provided");

    const userState = await this.findCustomerByEmail(widgetId,inputDto.loginData.checkEmail);

    if(userState === UserState.UNKNOWN) {
      let errors = await validate(inputDto.loginData.userData);
      if(errors.length) {
        let errorMessage : string[] = [];
        errors.forEach(e => {
          errorMessage.push(Object.values(e.constraints).toString())
        })
        throw new BadRequestException(errorMessage);
      }
    } else {
      inputDto.loginData.userData.firstName = "";
      inputDto.loginData.userData.lastName = "";
      inputDto.loginData.userData.title = null;
      inputDto.loginData.userData.prefix = null;
      inputDto.loginData.userData.phone = "";
    }

    const updateInvoiceData = inputDto.invoiceWanted && userState !== UserState.COMPLETE ? {
      invoiceData : JSON.stringify(inputDto.invoiceData)
    } : {};

    try {
      let locationId = await this.prisma.widget.findOne({
        where: {
          id: widgetId
        },
        select: {
          locationId: true
        }
      });

      let result = await this.prisma.customer.upsert({
        where: {
          email_locationId: {
            email: inputDto.loginData.checkEmail,
            locationId: locationId.locationId
          }
        },
        create: {
          email: inputDto.loginData.checkEmail,
          firstName: inputDto.loginData.userData.firstName,
          lastName: inputDto.loginData.userData.lastName,
          prefix: inputDto.loginData.userData.prefix,
          title: inputDto.loginData.userData.title,
          phone: inputDto.loginData.userData.phone,
          location: {
            connect: {
              id: locationId.locationId
            }
          },
          ...updateInvoiceData,
          orders: {
            connect: {
              id: orderId
            }
          }
        },
        update: {
          ...updateInvoiceData,
          orders: {
            connect: {
              id: orderId
            }
          }
        },
        select: {
          invoiceData: true
        }
      })
    
      return this.isJsonString(result.invoiceData) ? UserState.COMPLETE : UserState.INVOICEDATAMISSING;
    } catch(e) {
      return null;
    }
  }

  async putPaymentMethod(widgetId: string, orderId: string, payload: PaymentMethodDto) : Promise<PaymentMethod> {
    if(!orderId)
      throw new BadRequestException("no orderId provided");

    let [isPaymentMethodAvailable,existingPaymentToken] = await Promise.all([this.paymentHelper.paymentMethodAvailable(widgetId,payload.paymentMethod),this.getPaymentToken(orderId)]);

    if(!isPaymentMethodAvailable)
      throw new BadRequestException("payment method "+payload.paymentMethod+" is not available");


    let result = await this.prisma.order.update({
      where: {
        id: orderId
      },
      data: {
        payment: {
          upsert: {
            create: {
              paymentType: payload.paymentMethod
            },
            update: {
              paymentType: payload.paymentMethod,
              token: existingPaymentToken?.method === payload.paymentMethod ? existingPaymentToken.token : null
            }
          }
        }
      },
      select: {
        payment: {
          select: {
            paymentType: true
          }
        }
      }
    });

    return result.payment.paymentType;
  }

  async getPaymentIntent(widgetId: string, orderId: string) {
    if(!orderId)
      throw new BadRequestException("no orderId provided");

    let [totalPrice,paymentMethodsAndKeys,existingPaymentToken] = await Promise.all([this.getOrderPriceSum(orderId), this.paymentHelper.getPaymentMethodsAndKeys(widgetId),this.getPaymentToken(orderId)]);

    if(existingPaymentToken === null)
      throw new BadRequestException("payment token hasn't been prepared yet");

    let resultIntentId : string = null;
    let clientSecret : string = null;
    if(existingPaymentToken.method === PaymentMethod.CREDITCARD || existingPaymentToken.method === PaymentMethod.MOBILEPAYMENT) {
      if(paymentMethodsAndKeys.paymentKeys.STRIPE) {
        let stripeKey = paymentMethodsAndKeys.paymentKeys.STRIPE.privateKey;
        const stripe = new Stripe(stripeKey,{apiVersion: '2020-08-27'});

        if(existingPaymentToken.token) { //update Price if necessary
          let paymentIntent = await stripe.paymentIntents.retrieve(existingPaymentToken.token)
          if(paymentIntent.amount !== totalPrice) {
            paymentIntent = (await stripe.paymentIntents.update(existingPaymentToken.token, {
              amount: totalPrice
            }));
            resultIntentId = paymentIntent.id;
            clientSecret = paymentIntent.client_secret;
          } else {
            resultIntentId = paymentIntent.id;
            clientSecret = paymentIntent.client_secret;
          }
        } else { //create stripe payment-intent
          let customerMail = await this.prisma.order.findOne({
            where: {
              id: orderId
            },
            select: {
              customer: {
                select: {
                  email: true
                }
              }
            }
          })

          let paymentIntent = (await stripe.paymentIntents.create({
            amount: totalPrice,
            currency: 'eur',
            payment_method_types: ['card'],
            capture_method: 'automatic',
            receipt_email: customerMail.customer.email
          }));
          resultIntentId = paymentIntent.id;
          clientSecret = paymentIntent.client_secret;
        }
      } else if(paymentMethodsAndKeys.paymentKeys.CONCARDIS) {

      } else
        throw new BadRequestException("creditcard payment or mobile payment not supported");
    } else if(existingPaymentToken.method === PaymentMethod.PAYPAL) {
      if(paymentMethodsAndKeys.paymentKeys.PAYPAL) {

      } else
        throw new BadRequestException("paypal payment not supported");
    }

    await this.prisma.payment.update({
      where: {
        orderId: orderId
      },
      data: {
        token: resultIntentId,
        totalPrice: totalPrice
      }
    })

    return clientSecret;
  }

  private async getPaymentToken(orderId: string) {
    let paymentToken = await this.prisma.order.findOne({
      where: {
        id: orderId
      },
      select: {
        payment: {
          select: {
            token: true,
            paymentType: true
          }
        }
      }
    })

    return paymentToken.payment ? {method: paymentToken.payment.paymentType, token: paymentToken.payment.token} : null;
  }

  private async getOrderPriceSum(orderId: string) : Promise<number> {
    const allOrders = await this.prisma.voucherTemp.findMany({
      where: {
        orderId: orderId
      },
      select: {
        initialValue: true,
        quantity: true
      }
    });

    return allOrders.reduce((sum,current) => sum + current.initialValue*current.quantity, 0);
  }

  async closeCart(widgetId: string, orderId: string): Promise<boolean> {
    if(!orderId || !widgetId)
      throw new BadRequestException("no orderId or widgetId provided");

    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        widgetId: widgetId
      }, select: {
        state: true,
        widget: {
          select: {
            locationId: true
          }
        },
        payment: {
          select: {
            token: true
          }
        }
      }
    });

    if(!order)
      throw new UnauthorizedException("order with id "+orderId+" is not accessible");

    if(order.state !== 'INCOMPLETE')
      return false;

    if(!order.payment.token)
      throw new BadRequestException("no token existent");
    
    const state = await this.paymentHelper.getPaymentIntentState(order.widget.locationId, order.payment.token);

    if(state === 'succeeded') {
      await Promise.all([this.createRealTokens(orderId), this.prisma.order.update({
        where: {
          id: orderId
        },
        data: {
          state: 'COMPLETED',
          orderingTime: new Date(Date.now()),
          number: this.createUniqueId(16)
        }
      })]);
      return true;
    }
    return false;
  }

  private async createRealTokens(orderId: string) {
    const [tempTokens,location] = await Promise.all([this.prisma.voucherTemp.findMany({
        where: {
          orderId: orderId
        }
      }),this.prisma.order.findOne({
        where: {
          id: orderId
        },
        select: {
          widget: {
            select: {
              locationId: true
            }
          }
        }
      })
    ]);

    const toBeCreated : Promise<any>[] = [];

    const locationId = location.widget.locationId;
    await Promise.all(tempTokens.map(async temp => {
      for(let n = 0; n < temp.quantity; n++) {
        let voucherNumber : string;
        let testQuery : Voucher;
        do {
          voucherNumber = this.createUniqueId(8);
          testQuery = await this.prisma.voucher.findFirst({
            where: {
              number: voucherNumber,
              order: {
                widget: {
                  locationId: locationId
                }
              }
            }
          })
        } while(!!testQuery);

        toBeCreated.push(this.prisma.voucher.create({
          data: {
            layout: {
              connect: {
                id: temp.layoutId
              }
            },
            initialValue: temp.initialValue,
            annotations: temp.annotations,
            number: voucherNumber,
            order: {
              connect: {
                id: temp.orderId
              }
            }
          }
        }));
      }
    }));
    await Promise.all(toBeCreated);
  }

  private createUniqueId(length: number) {
    const alphabeth = "0123456789ABCDEFGHIJKLMNPQRSTUVWXYZ"

    let result = "";

    for(let i = 0; i < length; i++) {
      result += alphabeth.charAt(Math.floor(Math.random()*alphabeth.length));
    }

    return result;
  }

  async getCartState(orderId: string) {
    if(!orderId)
      throw new BadRequestException("no orderId provided");

    const result = await this.prisma.order.findOne({
      where: {
        id: orderId
      },
      select: {
        state: true
      }
    });

    return result.state;
  }

  async getImprint(widgetId: string, type: 'DISCLAIMER' | 'PRIVACY' | 'AGB') {
    const result = await this.prisma.message.findMany({
      where: {
        location: {
          widgets: {
            some: {
              id: widgetId
            }
          }
        },
        messageType: type
      },
      select: {
        text: true,
        textType: true
      }
    });

    if(result.length > 0)
      return result[0];
    return [];
  }
}
