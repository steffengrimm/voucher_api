import { Injectable, Scope } from '@nestjs/common';
import { readFile, readFileSync } from 'fs';
import { Color, CustomFontEmbedder, PDFDict, PDFDocument, PDFFont, PDFName, PDFRef, rgb, StandardFontEmbedder, StandardFonts} from 'pdf-lib';
import { FontNames } from '@pdf-lib/standard-fonts';
import * as fontkit from '@pdf-lib/fontkit'
import { QRCode } from './qr-generator';
import { fromBuffer } from "pdf2pic";
import { PrismaService } from './prisma.service';
import { join } from 'path';
import { numberAsWord } from './number-as-word';
import { LayoutFormat, TextFormat } from './layout-format';

const rootDirectory = join(__dirname, '..', '..', 'static');
const layoutDirectory = join(rootDirectory, 'layouts');
const fontDirectory = join(rootDirectory, 'fonts');
const assetDirectory = (widgetId: string) => join(rootDirectory, 'assets', 'previews', widgetId);

const readFileAsync = (path: string | number | Buffer | URL, options?: {encoding?: null, flag?: string}) => {
  return new Promise<Buffer>((resolve, reject) => {
    readFile(path, options, (err: NodeJS.ErrnoException, data: Buffer) => {
      if(err)
        reject(err);
      else
        resolve(data);
    });
  });
}

const defaultConfig : LayoutFormat = {
  text: {
    value: {
      position: [143.7375,667.7064],
      anchorX: 'center',
      anchorY: 'middle',
      size: 36,
      font: 'OPENSANSBOLD',
      color: '#ffffff',
    },
    number: {
      position: [359.292,655.6898],
      anchorX: 'center',
      anchorY: 'middle',
      size: 18,
      font: 'OPENSANS',
      color: '#153d8a'
    },
    date: {
      position: [304.4299,702.6849],
      anchorX: 'center',
      anchorY: 'middle',
      size: 9,
      font: 'OPENSANS',
      color: '#153d8a'
    },
    dateUntil: {
      position: [407.2656,702.6849],
      anchorX: 'center',
      anchorY: 'middle',
      size: 9,
      font: 'OPENSANS',
      color: '#153d8a'
    },
    valueAsWord: {
      position: [143.6829,695.9637],
      anchorX: 'center',
      anchorY: 'middle',
      size: 10,
      font: 'OPENSANSBOLD',
      color: '#fff'
    }
  },
  code: {
    position: [469.692,634.647],
    size: 80.736,
    color: '#153d8a',
    padding: 0,
  }
}

@Injectable({ scope: Scope.DEFAULT })
export class PDFService {
  //private pdfBytes = readFileSync("/mnt/c/Users/Steffen\ Grimm/Desktop/Gutschein_Reservision.pdf");
  private _openSans : Promise<Buffer>;
  private _openSansBold : Promise<Buffer>;
  private _fontStorage : Map<string, Promise<ArrayBuffer>> = new Map();
  private valueFormat : Intl.NumberFormat;
  private dateFormat : Intl.DateTimeFormat;

  constructor(private prisma: PrismaService) {
    this._openSans = readFileAsync(join(fontDirectory,'OpenSans-Regular.ttf'));
    this._openSansBold = readFileAsync(join(fontDirectory,'OpenSans-Bold.ttf'));

    this.valueFormat = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
    this.dateFormat = new Intl.DateTimeFormat('de-DE');
  }

  private openLayoutFile(name: string) {
    return readFileAsync(join(layoutDirectory,name)+'.pdf');
  }

  private async makeConfiguration(input: string) : Promise<LayoutFormat> {
    try {
      let obj : {} = JSON.parse(input);
      if(Object.keys(obj)) {
        const config = obj as LayoutFormat;
        const usedFonts = Object.keys(config.text).map(type => (<TextFormat>config.text[type]).font);
        if(usedFonts.includes('OPENSANS'))
          this._fontStorage.set('OPENSANS', this._openSans);
        if(usedFonts.includes('OPENSANSBOLD'))
          this._fontStorage.set('OPENSANSBOLD', this._openSansBold);

        if(config.fonts) {
          await Promise.all(Object.keys(config.fonts).map(async descriptor => {
            const url = config.fonts[descriptor];
            if(url) {
              return fetch(url).then(response => {
                this._fontStorage.set(descriptor, response.arrayBuffer());
                return response;
              }).catch(e => {});
            }
          }));
        }
        return Promise.resolve(config);
      }
    } catch(e) {
    } finally {
      this._fontStorage.set('OPENSANS', this._openSans);
      this._fontStorage.set('OPENSANSBOLD', this._openSansBold);
      return Promise.resolve(defaultConfig);
    }
  }

  private static parseColor(colorString: string) : Color {
    if(colorString.charAt(0) === "#")
      colorString = colorString.substr(1);

    let _rgb : number[];
    if(colorString.length === 6) {
      _rgb = colorString.match(/.{2}/g).map(v => parseInt(v, 16) / 255);
    } else if(colorString.length === 3) {
      _rgb = colorString.split('').map(v => parseInt(v,16) / 15);
    } else {
      _rgb = [0,0,0];
    }

    const [r,g,b] = _rgb;

    return rgb(r,g,b);
  }

  private getVoucherValidity(orderingTime: Date, validUntil?: {date?: string, range?: string}) {
    const beforeTime = new Date(orderingTime);
    if(validUntil) {
      if(validUntil.range) {
        const [,value, unit] = validUntil.range.match(/(\d+)(\w)/);
        if(unit === "y") {
          beforeTime.setFullYear(beforeTime.getFullYear() + parseInt(value));
        } else {
          beforeTime.setDate(beforeTime.getDate() + parseInt(value));
        }
      } else if(validUntil.date) {
        const [year, month, day] = validUntil.date.split('-').map(x => parseInt(x));
        beforeTime.setFullYear(year, month - 1, day);
      }
    } else {
      beforeTime.setFullYear(beforeTime.getFullYear() + 3, 11, 31)
    }
    return beforeTime;
  }

  async generatePDF(orderId : string) {
    const vouchers = await this.prisma.voucher.findMany({
      where: {
        orderId: orderId
      },
      include: {
        order: {
          select: {
            orderingTime: true
          }
        }, layout: {
          select: {
            positioning: true
          }
        }
      }
    });

    const allUsedlayouts = new Map<string, Promise<[Buffer,LayoutFormat]>>();

    vouchers.forEach(voucher => {
      const layoutId = voucher.layoutId;
      if(allUsedlayouts.has(layoutId))
        return;
      
      const bytes = this.openLayoutFile(layoutId);
      const config = this.makeConfiguration(voucher.layout.positioning);
      allUsedlayouts.set(layoutId, Promise.all([bytes,config]))
    })

    await Promise.all(allUsedlayouts.values());

    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    //TODO!! Fonts nur einmal einbinden
    const pdfFontStorage : Map<string,Promise<PDFFont>> = new Map();
    await Promise.all([...this._fontStorage.entries()].map(async ([desc, buffer]) => {
      pdfFontStorage.set(desc, pdfDoc.embedFont(await buffer));
    }));

    await Promise.all(vouchers.map(async (voucher) => {
      const [voucherLayout,layoutConfig] = await allUsedlayouts.get(voucher.layoutId);
      let [embeddedPage] = await pdfDoc.embedPdf(voucherLayout);

      const {width: pageWidth, height: pageHeight} = embeddedPage.size();
      const newPage = pdfDoc.addPage([pageWidth, pageHeight]);
      newPage.drawPage(embeddedPage);

      const validBoundary = this.getVoucherValidity(voucher.order.orderingTime, layoutConfig.validity);

      const textToWrite : {[key in keyof LayoutFormat['text']] : string} = {
        value: this.valueFormat.format(voucher.initialValue / 100).replace(/,00/,""),
        valueAsWord: numberAsWord(voucher.initialValue / 100),
        date: this.dateFormat.format(voucher.order.orderingTime),
        dateUntil: this.dateFormat.format(validBoundary),
        number: voucher.number
      };
      
      await Promise.all(Object.keys(textToWrite).map(async type => {
        const text = ''+textToWrite[type];
        const textConfig = layoutConfig.text[type] as TextFormat;
        //console.log(type, textConfig,'#################');
        
        if(text && textConfig) {
          let currentFont : PDFFont;
          if(pdfFontStorage.has(textConfig.font))
            currentFont = await pdfFontStorage.get(textConfig.font);
          else {
            if(!pdfFontStorage.has('OPENSANS')) {
              let openSansPromise = pdfDoc.embedFont(await this._openSans);
              pdfFontStorage.set('OPENSANS', openSansPromise)
              currentFont = await openSansPromise;
            } else
              currentFont = await pdfFontStorage.get('OPENSANS');
          }
          /*if(textConfig.font === 'OPENSANSBOLD')
            currentFont = await pdfDoc.embedFont(await this.openSansBold);
          else if(textConfig.font === 'OPENSANS')
            currentFont = await pdfDoc.embedFont(await this.openSans);
          else {
            await (async() => {
              try {
                if(this.fontStorage.has(textConfig.font)) {
                  currentFont = await pdfDoc.embedFont(await this.fontStorage.get(textConfig.font));
                  return;
                }
              } catch(e){
              } finally {
                currentFont = await pdfDoc.embedFont(await this.openSans); //Fallback
              }
            })();
          }*/
          
          const color = PDFService.parseColor(textConfig.color);

          let [posX, posY] = textConfig.position;
          posY = pageHeight - posY;
          if(textConfig.anchorX === 'center') {
            posX -= currentFont.widthOfTextAtSize(text, textConfig.size) / 2;
          } else if(textConfig.anchorX === 'right') {
            posX -= currentFont.widthOfTextAtSize(text, textConfig.size);
          }

          if(textConfig.anchorY === 'middle') {
            posY -= currentFont.heightAtSize(textConfig.size,{descender: false}) / 2;
          } else if(textConfig.anchorY === 'top') {
            posY -= currentFont.heightAtSize(textConfig.size,{descender: false});
          }

          newPage.drawText(text, {
            size: textConfig.size,
            x: posX,
            y: posY,
            color: color,
            font: currentFont
          })
        }
      }));

      ////QR

      const qr = new QRCode(textToWrite.number, {caseInsensitive: true});
      const qrBitField = qr.getQRCodeBitmap() as number[][];

      const codeConfig = layoutConfig.code;
      let [posX, posY] = codeConfig.position;

      const paddingModules = codeConfig.padding ?? 0;

      const qrSize = codeConfig.size;
      const moduleSize = (qrSize / (2*paddingModules + qrBitField.length));
      const codeSize = moduleSize * qrBitField.length;

      posY = pageHeight - posY - qrSize;

      newPage.drawSquare({
        x: posX,
        y: posY,
        size: qrSize,
        color: rgb(1,1,1),
      })
  
      const qrColor = PDFService.parseColor(codeConfig.color);
  
      qrBitField.forEach((row, y) => {
        row.forEach((col, x) => {
          if(col === 1) {
            newPage.drawSquare({
              x: posX + (paddingModules + x) * moduleSize,
              y: posY + (codeSize - moduleSize) + (paddingModules - y) * moduleSize,
              size: moduleSize,
              color: qrColor
            });
          }
        })
      });
    }));

    /*const {Font} = frontPage.node.normalizedEntries();
    const FontRef = Font.values()[0] as PDFRef;
    let fontName = (pdfDoc.context.lookup(FontRef) as PDFDict).get(PDFName.of('BaseFont')) as PDFName;
    console.log(fontName.decodeText())
    frontPage.setFont(PDFFont.of(FontRef as PDFRef, pdfDoc, StandardFontEmbedder.for(FontNames.Courier,fontName.decodeText())));*/

  
    return Buffer.from((await pdfDoc.save()).buffer);
  }

  public async createPDFPreview(widgetId: string, layoutId: string) {
    const layoutBytes = await this.openLayoutFile(layoutId);

    const firstPage = (await PDFDocument.load(layoutBytes)).getPage(0);

    const {width: pageWidth, height: pageHeight} = firstPage.getSize();

    const options = {
      density: 100,
      saveFilename: layoutId,
      savePath: assetDirectory(widgetId),
      format: "png",
      width: 600,
      height: 600*pageHeight/pageWidth
    };

    const storeAsImg = fromBuffer(layoutBytes);
    return await storeAsImg(1);
  }
}
/*
    

    let storeAsImg = fromPath("/mnt/c/Users/Steffen\ Grimm/Desktop/Gutschein_Reservision.pdf",options);
    storeAsImg(1).then(resolve => console.log("Page1 converted"));*/
