import { Injectable, Scope } from "@nestjs/common";
import Stripe from 'stripe';
import { PaymentHandlerKeys, PaymentMethodSelection, PaymentMethodDto } from "src/shop/settings.dto";
import { PrismaService } from "src/helper/prisma.service";

@Injectable({ scope: Scope.DEFAULT })
export class PaymentHelper {
    constructor(
        private readonly prisma: PrismaService
    ) {}

    async paymentMethodAvailable(widgetId: string, method: PaymentMethodDto['paymentMethod']) : Promise<boolean> {
        return (await this.getPaymentMethodsAndKeys(widgetId)).paymentMethods?.includes(method) ?? false;
    }

    async getPaymentMethodsAndKeys(widgetOrLocationId: string | number) {
        let queryString = {};

        if(isNaN(widgetOrLocationId as number)) {
            queryString = {
                location: {
                    widgets: {
                        some: {
                            id: widgetOrLocationId
                        }
                    }
                }
            }
        } else {
            queryString = {
                locationId: widgetOrLocationId
            }
        }


        let rawResult = await this.prisma.locationSetting.findMany({
            where: {
                ...queryString,
                OR: [
                    {
                        settingType: 'PAYMENTMETHODS'
                    },
                    {
                        settingType: 'PAYMENTKEYS'
                    }
                ]
            },
            select: {
                settingType: true,
                value: true
            }
        });
    
        //console.log(rawResult, widgetId);
    
        let paymentConfig : {paymentKeys?: PaymentHandlerKeys, paymentMethods?: PaymentMethodSelection} = {}
    
        rawResult.forEach(config => {
            switch(config.settingType) {
                case 'PAYMENTKEYS': {
                    paymentConfig.paymentKeys = <PaymentHandlerKeys>JSON.parse(config.value);
                    break;
                }
                case 'PAYMENTMETHODS':
                    paymentConfig.paymentMethods = <PaymentMethodSelection>JSON.parse(config.value);
                    break;
                }
        });
    
        if(!paymentConfig.paymentKeys?.PAYPAL)
            paymentConfig.paymentMethods = paymentConfig.paymentMethods?.filter(m => m !== "PAYPAL")
        if(!paymentConfig.paymentKeys?.STRIPE && !paymentConfig.paymentKeys?.CONCARDIS)
            paymentConfig.paymentMethods = paymentConfig.paymentMethods?.filter(m => m !== "CREDITCARD" && m !== "MOBILEPAYMENT")
    
        return paymentConfig;
    }

    async getPaymentIntentState(locationId: number, token: string) {
        let paymentKeys = (await this.getPaymentMethodsAndKeys(locationId)).paymentKeys;

        if(paymentKeys.STRIPE) {
            const stripe = new Stripe(paymentKeys.STRIPE.privateKey,{apiVersion: '2020-08-27'});
            let paymentIntent = (await stripe.paymentIntents.retrieve(token));
            return paymentIntent.status;
        } else if(paymentKeys.CONCARDIS) {
            //not yet implemented
        }
    }

    async cancelPaymentIntent(locationId: number, token: string) {
        let paymentKeys = (await this.getPaymentMethodsAndKeys(locationId)).paymentKeys;

        if(paymentKeys.STRIPE) {
            const stripe = new Stripe(paymentKeys.STRIPE.privateKey,{apiVersion: '2020-08-27'});
            let paymentIntent = (await stripe.paymentIntents.retrieve(token));
            stripe.paymentIntents.cancel(paymentIntent.id);
        } else if(paymentKeys.CONCARDIS) {
            //not yet implemented
        }
    }
}