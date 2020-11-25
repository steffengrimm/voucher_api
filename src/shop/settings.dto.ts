import { PaymentMethod } from "@prisma/client"
import { IsEnum, IsNotEmpty } from "class-validator"

enum PaymentHandler {
    STRIPE,
    CONCARDIS,
    PAYPAL,
}

export type PaymentHandlerKeys = {[key in (keyof typeof PaymentHandler)]?: {publicKey: string, privateKey: string}}
export type PaymentHandlerDto = {[key in (keyof typeof PaymentHandler)]?: string}
export type PaymentMethodSelection = (keyof typeof PaymentMethod)[]

export class PaymentMethodDto {
    @IsEnum(PaymentMethod)
    @IsNotEmpty()
    paymentMethod: PaymentMethod;
}