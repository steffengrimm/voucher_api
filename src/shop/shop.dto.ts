import { Type } from 'class-transformer'
import { IsNotEmpty, IsIn, IsPositive, IsString, MaxLength, IsOptional, IsEmail, IsBoolean, ValidateNested, ValidateIf, IsEnum } from 'class-validator'
//import { ValidateConditionalGroup } from './helper/validate.conditional'
import { CustomerTitle } from '@prisma/client'

export class AddressDataDto {
    @IsNotEmpty()//{groups:['full']})
    street: string
    @IsNotEmpty()//{groups:['full']})
    houseNumber: string
    @IsNotEmpty()//{always: true})
    zip: string
    @IsNotEmpty()//{groups:['full']})
    city: string
}


/*export class ShippingAddressDto {
    @IsIn(['DELIVERY','PICKUP'])
    orderType: 'DELIVERY' | 'PICKUP'

    @Type(() => AddressDataDto)
    //@ValidateConditionalGroup([o => o.orderType === 'DELIVERY','full'])
    addressData: AddressDataDto;

    @IsNotEmpty()
    expectedDeliveryTime: number;
}

export class AdditionalAddressDto {
    @IsString()
    @IsOptional()
    annotations: string

    @IsString()
    @IsOptional()
    bellName: string

    @IsString()
    @IsOptional()
    story: string
}*/

export class VoucherDto {
    layoutId: string;

    initialValue: number;

    @IsOptional()
    @IsPositive()
    quantity?: number;

    @IsOptional()
    @MaxLength(200)
    annotations?: string
}

export class UpdateVoucherDto {
    itemId: string

    @IsOptional()
    @IsPositive()
    initialValue?: number

    @IsOptional()
    @MaxLength(200)
    annotations?: string
}

export class UpdateMultipleVoucherDto {
    layoutId: string;
    initialValue: number;

    @IsOptional()
    @IsPositive()
    newValue?: number

    @IsOptional()
    @IsPositive()
    quantity?: number;

    @IsOptional()
    @MaxLength(200)
    annotations?: string
}

export enum UserState {
    UNKNOWN,
    INVOICEDATAMISSING,
    COMPLETE
}

export class DetermineUserDto {
    @IsEmail()
    emailAddress: string

    @IsOptional()
    @IsEnum(UserState)
    userState?: keyof typeof UserState
}

class UserData {
    @IsOptional()@IsString()
    title?: string
    @IsOptional()@IsEnum(CustomerTitle)
    prefix?: keyof typeof CustomerTitle
    @IsNotEmpty()@IsString()
    firstName: string
    @IsNotEmpty()@IsString()
    lastName: string
    @IsOptional()@IsString()
    phone?: string
}

class LoginData {
    @IsEmail()
    checkEmail: string

    @Type(() => UserData)
    @IsNotEmpty()
    userData: UserData
}

class InvoiceData {
    @IsNotEmpty()@IsString()
    street: string
    @IsNotEmpty()@IsString()
    houseNumber: string
    @IsNotEmpty()@IsString()
    zip: string
    @IsNotEmpty()@IsString()
    city: string;
    @IsOptional()@IsString()
    addressSuffix?: string
    @IsOptional()@IsString()
    company?: string
    @IsOptional()@IsString()
    costCentre?: string
    @IsOptional()@IsString()
    vatId?: string
}

export class PutCustomerDataDto {
    @Type(() => LoginData)
    @ValidateNested()
    loginData: LoginData;

    @IsBoolean()
    invoiceWanted: Boolean

    @Type(() => InvoiceData)
    @ValidateIf(o => o.invoiceWanted === true)@ValidateNested()
    invoiceData: InvoiceData
}