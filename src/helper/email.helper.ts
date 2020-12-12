import { createTransport } from 'nodemailer';
import * as SMTPTransport from "nodemailer/lib/smtp-transport";
import { Order, Customer, Location, Payment } from "@prisma/client";
import { join } from "path";
import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/helper/prisma.service';
import { MJMLAdvanced } from './mjml-advanced';
import Mail = require('nodemailer/lib/mailer');
import { PDFService } from './pdf.service';
import { safeJSONParse } from './safe-json';

type ServerSettings = {
    hostname: string,
    name: string,
    email: string,
    username: string,
    password: string,
    port: number,
    bcc?: string,
    subject?: string
}

const rootDirectory = join(__dirname, '..', '..', 'static');

const mailTemplate = (locationId: string | number) => join(rootDirectory, 'mails', ''+locationId, 'template.mjml');

@Injectable()
export class EMailHelper {
    private dateFormat : Intl.DateTimeFormat;
    private valueFormat : Intl.NumberFormat;

    constructor(
        private readonly prisma: PrismaService,
        private readonly pdfService: PDFService
    ){
        this.valueFormat = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
        this.dateFormat = new Intl.DateTimeFormat('de-DE');
    }

    async sendConfirmationMail(orderId: string): Promise<boolean> {
        const order = await this.prisma.order.findOne({
            where: {
                id: orderId
            }, select: {
                widget: {
                    select: {
                        locationId: true
                    }
                },
                customer: {
                    select: {
                        email: true
                    }
                }
            }
        })

        if(!order)
            return;

        const {transporter, settings} = await this.getServerData(order.widget.locationId);

        let html = await this.mailTemplateForOrder(orderId);

        try {
            await transporter.sendMail({
                from: '"'+settings.name+'" <'+settings.email+'>',
                to: order.customer.email,
                bcc: settings.bcc,
                subject: settings.subject,
                html: html,
                attachments: [
                    {
                        filename: 'Gutschein.pdf',
                        content: await this.pdfService.generatePDF(orderId),
                        contentType: 'application/pdf'
                    }
                ]
            })
            console.log("sendMail OK");
            return true;
        } catch(e) {
            console.log("sendMail NO!", e);
            return false;
        }
    }

    private async getServerData(locationId: number) : Promise<{transporter: Mail, settings: ServerSettings}> {
        let mailSettings = await this.prisma.locationSetting.findMany({
            where: {
                locationId: locationId,
                settingType: 'MAILSERVER'
            }
        });

        if(!mailSettings.length)
            throw new Error("no mail-server data provided");

        const serverData = JSON.parse(mailSettings[0].value);
        
        let transporter = createTransport(new SMTPTransport({
            host: serverData.hostname,
            auth: {
                user: serverData.username,
                pass: serverData.password
            },
            port: serverData.port,
            secure: serverData.port === 465
        }));

        return {transporter: transporter, settings: serverData};
    }

    async mailTemplateForOrder(orderId: string) {
        //console.log("//"+tcpPort+"/assets/images/ckhdggtuw000001l3d8v0ca28/mail/logo.png");
        const order = await this.prisma.order.findOne({
            where: {
                id: orderId
            },
            select: {
                number: true,
                orderingTime: true,
                customer: {
                    select: {
                        email: true,
                        firstName: true,
                        lastName: true,
                        prefix: true,
                        invoiceData: true
                    }
                },
                vouchers: {
                    select: {
                        number: true,
                        layoutId: true,
                        initialValue: true
                    }
                },
                payment: {
                    select: {
                        paymentType: true
                    }
                },
                widget: {
                    select: {
                        locationId: true,
                    }
                }
            }
        });

        const [locationSettings] = await Promise.all([this.prisma.locationSetting.findOne({
            where: {
                locationId_settingType: {
                    locationId: order.widget.locationId,
                    settingType: 'SOCIALMEDIA'
                }
            },
            select: {
                value: true
            }
        })]);

        const socialMedia = this.getSocialMedia(safeJSONParse(locationSettings.value));

        const path = this.getMailAssetPath(order.widget.locationId);

        let billingAddress : any;
        try {
            billingAddress = JSON.parse(order.customer.invoiceData);
        } catch(e) {
            billingAddress = {};
        }

        const voucherGroupsRaw = new Map<number,number>();
        order.vouchers.map(voucher => {
            if(!voucherGroupsRaw.has(voucher.initialValue))
            voucherGroupsRaw.set(voucher.initialValue, 1);
            else
            voucherGroupsRaw.set(voucher.initialValue, voucherGroupsRaw.get(voucher.initialValue) + 1);
        });

        const voucherGroups : any[] = [];
        let totalSum : number = 0;
        [...voucherGroupsRaw.entries()].forEach(([value,quantity]) => {
            value /= 100;
            voucherGroups.push({
                initialValue: this.valueFormat.format(value),
                quantity: quantity,
                sum: this.valueFormat.format(value*quantity)
            })
            totalSum += value*quantity;
        });

        if(!order)
            throw Error("no order with id "+orderId+" found");

        let parser = new MJMLAdvanced();
        let template = parser.compile(mailTemplate(order.widget.locationId));
        return template({
            customer: {
                prefix: order.customer.prefix === 'MR' ? 'Sehr geehrter Herr' : 'Sehr geehrte Frau',
                firstName: order.customer.firstName,
                lastName: order.customer.lastName,
                email: order.customer.email
            },
            order: {
                number: order.number,
                orderingTime: this.dateFormat.format(order.orderingTime),
                payMethod: order.payment.paymentType
            },
            voucherGroups: voucherGroups,
            totalSum: this.valueFormat.format(totalSum),
            billingAddress: billingAddress,
            asset: path,
            base: this.getMailAssetPath(),
            socialMedia: socialMedia
        }) as string;
    }

    private getMailAssetPath(locationId?: string | number) {
        /*let host = hostname();
        if(tcpPort !== 80)
            host += ':'+tcpPort;

        return "//"+host+"/assets/mail/"+locationId+"/";*/

        return "https://api.voucher.reservision.com/assets/mail/"+(locationId ?? 'base') +"/";
    }

    private getSocialMedia(obj: any) {
        Object.keys(obj).forEach(key => {
            let url : string;
            switch(key) {
                case 'fb':
                    url = "https://www.facebook.com/";
                    break;
                case 'ig':
                    url = "https://www.instagram.com/";
                    break;
                case 'twitter':
                    url = "https://www.twitter.com/";
                    break;
            }
            obj[key] = url + obj[key];
        });
        return obj;
    }
}