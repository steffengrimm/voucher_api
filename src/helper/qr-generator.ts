import { sizeInBytes } from 'pdf-lib';
import { encodeMessage, bchLongDivisionReminder } from './reedSolomon';

////// DEBUG /////

const DEBUGCOLORS = [
    [
        {true: 'cornflowerblue', false: 'skyblue'},
        {true: 'orange', false: 'bisque'}
    ],
    [
        {true: 'yellow', false: 'lightyellow'},
        {true: 'darkgreen', false: 'forestgreen'}
    ],
    [
        {true: 'darkred', false: 'indianred'},
        {true: 'purple', false: 'blueviolet'}
    ]
]

/////////////////

const ALNUM_ALPHABETH = [...Array.from(Array(10)).map((_,d) => d.toString()), ...Array.from(Array(26)).map((_,c) => String.fromCharCode(c+65)), ' ', '$', '%', '*', '+', '-', '.', '/', ':'];

const CODEWORDS = [
    [[0,0],[0,0],[0,0],[0,0]],
    [[16,1],[19,1],[9,1],[13,1]],
    [[28,1],[34,1],[16,1],[22,1]],
    [[44,1],[55,1],[26,2],[34,2]],
    [[64,2],[80,1],[36,4],[48,2]],
    [[86,2],[108,1],[46,4],[62,4]],
    [[108,4],[136,2],[60,4],[76,4]],
    [[124,4],[156,2],[66,5],[88,6]],
    [[154,4],[194,2],[86,6],[110,6]],
    [[182,5],[232,2],[100,8],[132,8]],
    [[216,5],[274,4],[122,8],[154,8]],
    [[254,5],[324,4],[140,11],[180,8]],
    [[290,8],[370,4],[158,11],[206,10]],
    [[334,9],[428,4],[180,16],[244,12]],
    [[365,9],[461,4],[197,16],[261,16]],
    [[415,10],[523,6],[223,18],[295,12]],
    [[453,10],[589,6],[253,16],[325,17]],
    [[507,11],[647,6],[283,19],[367,16]],
    [[563,13],[721,6],[313,21],[397,18]],
    [[627,14],[795,7],[341,25],[445,21]],
    [[669,16],[861,8],[385,35],[485,20]],
    [[714,17],[932,8],[406,25],[512,23]],
    [[782,17],[1006,9],[442,34],[568,23]],
    [[860,18],[1094,9],[464,30],[614,25]],
    [[914,20],[1174,10],[514,32],[664,27]],
    [[1000,21],[1276,12],[538,35],[718,29]],
    [[1062,23],[1370,12],[596,37],[754,34]],
    [[1128,25],[1468,12],[628,40],[808,34]],
    [[1193,26],[1531,13],[661,42],[871,35]],
    [[1267,28],[1631,14],[701,45],[911,38]],
    [[1373,29],[1735,15],[745,48],[985,40]],
    [[1455,31],[1843,16],[793,51],[1033,43]],
    [[1541,33],[1955,17],[845,54],[1115,45]],
    [[1631,35],[2071,18],[901,57],[1171,48]],
    [[1725,37],[2191,19],[961,60],[1231,51]],
    [[1812,38],[2306,19],[986,63],[1286,53]],
    [[1914,40],[2434,20],[1054,66],[1354,56]],
    [[1992,43],[2566,21],[1096,70],[1426,59]],
    [[2102,45],[2702,22],[1142,74],[1502,62]],
    [[2216,47],[2812,24],[1222,65],[1582,77]],
    [[2334,49],[2956,25],[1276,68],[1666,81]]
];

const MASK : ((y:number,x:number) => 0 | 1)[] = [
    (y:number,x:number) => (x+y)%2 === 0 ? 1 : 0,
    (y:number,x:number) => (y%2) === 0 ? 1 : 0,
    (y:number,x:number) => (x%3) === 0 ? 1 : 0,
    (y:number,x:number) => ((x+y)%3) === 0 ? 1 : 0,
    (y:number,x:number) => ((Math.floor(y/2)+Math.floor(x/3))%2) === 0 ? 1 : 0,
    (y:number,x:number) => ((x*y)%2+(x*y)%3) === 0 ? 1 : 0,
    (y:number,x:number) => (((x*y)%2+(x*y)%3)%2) === 0 ? 1 : 0,
    (y:number,x:number) => (((x+y)%2+(x*y)%3)%2) === 0 ? 1 : 0,
];

enum ErrorLevel {
    M,L,H,Q
}

enum DataType {
    NUMERIC = "NUMERIC",
    ALNUM = "ALNUM",
    BYTE = "BYTE"
}
type TransformationConfigType = {
    [key in keyof typeof DataType]: {
        modeIdentifier: number,
        symbolSize: number;
        remainingSize: (_?: number) => number;
        countIndicatorSize: (_?: number) => number;
    };
};

const TransformationConfig : TransformationConfigType = {
    NUMERIC : {
        modeIdentifier: 0b0001,
        symbolSize: 10,
        remainingSize : (inputLength: number) => inputLength%3 === 0 ? 10 : 1+3*(inputLength%3),
        //countIndicatorSize: (version: number) => 10 + 2 * Math.floor((version + 7)/17)
        countIndicatorSize: (version: number) => version < 10 ? 10 : (version < 27 ? 12 : 14)
    },
    ALNUM: {
        modeIdentifier: 0b0010,
        symbolSize: 11,
        remainingSize : (inputLength: number) => inputLength%2 === 0 ? 11 : 6,
        //countIndicatorSize: (version: number) => 9 + 2 * Math.floor((version + 7)/17)
        countIndicatorSize: (version: number) => version < 10 ? 9 : (version < 27 ? 11 : 13)
    },
    BYTE: {
        modeIdentifier: 0b0100,
        symbolSize: 8,
        remainingSize : () => 8,
        //countIndicatorSize : (version: number) => 8 * (1 + Math.ceil((version - 9) / 40))
        countIndicatorSize: (version: number) => version < 10 ? 8 : 16
    }
}

interface QROptions {
    errorLvl?: keyof typeof ErrorLevel,
    caseInsensitive?: boolean
    debug?: number;
}

type QRModule = (0 | 1 | 'D' | 'L' | 'X');  // 1 equals 'D' and 0 equals 'L' in terms of coloring meaning 'dark' and 'light' respectively. 'X' is a placeholder for the format information before the actual information is placed after determination of the best mask
type QRField = QRModule[][];

export class QRCode {
    private input: string;
    private readonly inputLength : number
    private _rawInput: string;
    private errorLvl: ErrorLevel;
    private caseInsensitive: boolean;
    private mode : DataType;
    private version : number;
    private debug: number;
    
    private nrOfBlocks : number;
    private nrOfDataCodeWords : number;
    private nrOfErrorCodeWords : number;
    private dataCodeWords : number[][];
    private errorCodeWords : number[][];
    private bitStream : boolean[];
    private field : QRField; // (y|x) => value
    
    private static D_INPUT = 1;
    private static D_BYTE = 2;
    private static D_MASK = 4;

    constructor(input: string, options? : QROptions) {
        this.input = input;
        this.caseInsensitive = options?.caseInsensitive ?? false;
        if((this.inputLength = this.input.length) === 0)
            throw Error("no input text provided");
        this.debug = options?.debug ?? 0;
        this.readAsBitData(this.input);
        this.setECL(options?.errorLvl ?? 'M');
        //console.log(this._rawInput);
    }

    private readAsBitData(input: string) {
        if(this.caseInsensitive)
            input = input.toUpperCase();
        
        let chunks : number[];
        if(parseInt(input).toString() === input) {
            this.mode = DataType.NUMERIC;
            chunks = input.match(/\d{1,3}/g).map(c => parseInt(c));
        } else if(input.split('').filter(c => !ALNUM_ALPHABETH.includes(c)).length === 0) {
            this.mode = DataType.ALNUM;
            chunks = input.match(/.{1,2}/g,).map(c => {
                if(c.length === 1)
                    return ALNUM_ALPHABETH.indexOf(c);
                else {
                    let tmp = c.split('');
                    return 45*ALNUM_ALPHABETH.indexOf(tmp[0])+ALNUM_ALPHABETH.indexOf(tmp[1]);
                }
            });
        } else {
            this.mode = DataType.BYTE;
            //chunks = input.split(/(?:)/u).map(c => c.charCodeAt(0) & 0xff);
            chunks = [];
            for(let i = 0; i < input.length; i++) {
                chunks.push(input.charCodeAt(i) & 0xff)
            }
        }
        this._rawInput = this.convertChunksToBits(chunks);
    }

    private convertChunksToBits(chunks: number[]) : string {
        let lastChunk = chunks.pop();
        
        let returnData = "";
        chunks.forEach(c => {
            returnData += c.toString(2).padStart(TransformationConfig[this.mode].symbolSize,'0');
        });
        returnData += lastChunk.toString(2).padStart(TransformationConfig[this.mode].remainingSize(this.inputLength),'0')
        return returnData;
    }

    public setECL(ecl : keyof typeof ErrorLevel) {
        let oldLvl = this.errorLvl;
        this.errorLvl = ErrorLevel[ecl];
        if(this.errorLvl !== oldLvl) {
            this.generateBitStream();
            this.prepareField();
            this.writeDataToField();
            this.findBestMask();
        }
    }

    public getQRCodeSVG() {

    }

    public getQRCodeBitmap(flat : boolean = false) {
        if(flat)
            return this.field.reduce((flattened : number[], row) => flattened = [...flattened, ...(row.map(column => QRCode.isModuleDark(column)))], [])
        return this.field.map(row => row.map(column => QRCode.isModuleDark(column)));
    }

    public getSize() {
        return 17 + 4 * this.version;
    }

    public getMaxBitsInQR() {
        let v = Math.floor(this.version / 7);
        const nrOfAlignmentPatterns = this.version === 1 ? 0 : v * (v + 4) + 1;

        let bits = this.getSize() * this.getSize();
        bits -= 8*this.version + Math.ceil((this.version - 1) / 40)*(25 * nrOfAlignmentPatterns - 10 * Math.floor(this.version / 7)) + 36 * Math.floor((this.version + 33) / 40) + 225;
        return bits;
    }

    private generateBitStream() {
        this.generateDataCodeWords();
        this.generateErrorCodeWords();

        this.bitStream = [];
        let qMax = Math.ceil(this.nrOfDataCodeWords / this.nrOfBlocks);
        for(let pos = 0; pos < qMax; pos++) {
            this.dataCodeWords.forEach(block => {
                if(pos < block.length) {
                    for(let i = 7; i > -1; i--) {
                        this.bitStream.push(!!(block[pos] >> i & 1));
                    }
                }
            })
        }

        qMax = this.nrOfErrorCodeWords / this.nrOfBlocks;
        for(let pos = 0; pos < qMax; pos++) {
            this.errorCodeWords.forEach(block => {
                for(let i = 7; i > -1; i--) {
                    this.bitStream.push(!!(block[pos] >> i & 1));
                }
            })
        }

        //console.log(this.bitStream);
    }

    private generateDataCodeWords() {
        let version = 1;

        const rawInputLength = this._rawInput.length;
        let maxDataCodeWords : number;
        let dataWordsLength : number;
        do {
            maxDataCodeWords = CODEWORDS[version][this.errorLvl][0];
            //dataWordsLength = 1+Math.ceil((4 + TransformationConfig[this.mode].countIndicatorSize(version) + rawInputLength) / 8); //auffüllen auf 8Bits, dann ein volles NULL-Byte
            dataWordsLength = Math.ceil(1 + (TransformationConfig[this.mode].countIndicatorSize(version) + rawInputLength) / 8); //immer 4Bits Terminator, dann auffüllen auf 8
        } while(dataWordsLength > maxDataCodeWords && version++ < 42);

        //console.table({'version':version,'ECL':ErrorLevel[this.errorLvl],'maxDataCodeWords':maxDataCodeWords,'dataWordsLength':dataWordsLength,'rawInputLength':rawInputLength});

        this.version = version;
        this.nrOfDataCodeWords = maxDataCodeWords;

        const modeIdentifier = TransformationConfig[this.mode].modeIdentifier.toString(2).padStart(4,'0');
        let bitStream = modeIdentifier + this.inputLength.toString(2).padStart(TransformationConfig[this.mode].countIndicatorSize(version),'0') + this._rawInput;
        bitStream = bitStream.padEnd(dataWordsLength * 8, '0');

        const dataFields : number[] = [];
        for(let i = 0; i < dataWordsLength; i++) {
            dataFields.push(parseInt(bitStream.slice(8 * i, 8 * (i+1)),2));
        }
        for(let i = 0; i < maxDataCodeWords-dataWordsLength; i++) {
            dataFields.push(i%2 ? 0x11 : 0xec);
        }

        this.nrOfBlocks = CODEWORDS[version][this.errorLvl][1];
        const q = Math.floor(maxDataCodeWords/this.nrOfBlocks);

        this.dataCodeWords = [];
        for(let i = 0, offset = 0; i < this.nrOfBlocks; i++) {
            let length = (i+maxDataCodeWords < this.nrOfBlocks*(1+q)) ? q : 1+q;
            this.dataCodeWords.push(dataFields.slice(offset, offset+length));
            offset += length;
        }

        //console.log(version,this.dataCodeWords);
    }

    private generateErrorCodeWords() {
        this.nrOfErrorCodeWords = Math.floor(this.getMaxBitsInQR() / 8) - this.nrOfDataCodeWords;
        const q = this.nrOfErrorCodeWords / this.nrOfBlocks;
        
        this.errorCodeWords = [];
        this.dataCodeWords.forEach(cw => {
            this.errorCodeWords.push(encodeMessage(cw, q));
        })

        //console.log(this.errorCodeWords);
    }

    private prepareField() {
        let size = this.getSize();
        this.field = Array.from(Array(size)).map(_ => Array.from(Array(size)).map(_ => 0));

        //FINDER
        const finder = [3,size-4];
        for(let j = 0; j < 3; j++) {
            let cx = finder[j%2], cy = finder[Math.floor(j/2)];
            for(let dx = -4; dx < 5; dx++) {
                for(let dy = -4; dy < 5; dy++) {
                    let x = cx+dx, y = cy+dy;
                    if(x > -1 && y > -1 && x < size && y < size)
                        this.field[y][x] = Math.max(Math.abs(dx),Math.abs(dy))%2 !== 0 || dx === 0 && dy === 0 ? 'D' : 'L';
                }
            }
        }

        //ALIGNMENT
        if(this.version > 1) {
            const nrOfAlignmentsPositions = 1 + Math.floor(this.version/7);
            const alignmentDistance = 2 * Math.ceil(Math.round(4 * (1 + this.version)/nrOfAlignmentsPositions) / 2);      
            const lastAlignmentPos = size - 7;
            for(let cx = lastAlignmentPos; cx > 6; cx -= alignmentDistance) {
                for(let cy = lastAlignmentPos; cy > 6; cy -= alignmentDistance) {
                    for(let dx = -2; dx < 3; dx++) {
                        for(let dy = -2; dy < 3; dy++) {
                            let x = cx+dx, y = cy+dy;
                            this.field[y][x] = Math.max(Math.abs(dx),Math.abs(dy))%2 === 0 ? 'D' : 'L';
                        }
                    }
                }
                if(cx < lastAlignmentPos) {
                    for(let dx = -2; dx < 3; dx++) {
                        for(let dy = -2; dy < 3; dy++) {
                            this.field[cx+dy][6+dx] = this.field[6+dy][cx+dx] = Math.max(Math.abs(dx),Math.abs(dy))%2 === 0 ? 'D' : 'L';
                        }
                    }
                }
            }
        }

        //FORMAT-Placeholder

        for(let p = 0; p < 8; p++) {
            this.field[p][8] = this.field[8][p] = this.field[size-1-p][8] = this.field[8][size-1-p] = 'X';
        }

        this.field[8][8] = 'X';
        this.field[size-8][8] = 'D'
        //console.log("SIZE",size);

        //TIMER
        for(let p = 8; p < size-8; p++) {
            this.field[6][p] = this.field[p][6] = p%2 ? 'L' : 'D';
        }

        //Version

        if(this.version > 6) {
            const shiftedVersion = this.version << 12;
            const encodedVersion = shiftedVersion+bchLongDivisionReminder(shiftedVersion,0x1f25);

            for(let i = 0; i < 18; i++) {
                let x = Math.floor(i / 3), y = (6 + (i%3)) + 4 * this.version;
                this.field[y][x] = this.field[x][y] = (encodedVersion >> i) & 1 ? 'D' : 'L'
            }
        }
    }

    private writeDataToField() {
        const size = this.getSize();
        let upwards = true;
        
        let currentY = size-1, bPos = 0;
        for(let x = size-1; x > -1; x -= 2) {
            if(x === 6) x--; //TIMER (vertikal)
            for(let y = currentY; y > -1 && y < size; y = upwards ? y-1 : y+1) {
                if(this.field[y][x] === 'X' && this.field[y][x-1] === 'X') {
                    upwards = !upwards;
                    currentY = upwards ? y-1 : y+1;
                    break;
                }

                if(this.field[y][x] === 0)
                    this.field[y][x] = this.bitStream[bPos++] ? 1 : 0;

                if(this.field[y][x-1] === 0)
                    this.field[y][x-1] = this.bitStream[bPos++] ? 1 : 0;

                if(y === 0 && upwards || y === size - 1 && !upwards) {
                    upwards = !upwards;
                    currentY = y;
                    break;
                }
            }
        }

        if(!!(this.debug & QRCode.D_INPUT))
            this._debug(QRCode.D_INPUT);

            if(!!(this.debug & QRCode.D_BYTE))
            this._debug(QRCode.D_BYTE);
    }

    private findBestMask() {
        let tempFields : QRField[] = [];
        const size = this.getSize();

        MASK.forEach((mask,m) => {
            tempFields[m] = [];
            this.field.forEach((row,y) => {
                if(!tempFields[m][y])
                    tempFields[m][y] = [];
                row.forEach((column,x) => {
                    if(typeof column === "number") {
                        tempFields[m][y][x] = (mask(y,x) ^ column) as 0 | 1;
                    } else {
                        tempFields[m][y][x] = column;
                    }
                })
            });

            //write Format
            const format = bchLongDivisionReminder(((this.errorLvl << 3) + m) << 10,0x537) ^ 0x5412;
            let pos = 0, dhL = 0, dhH = 0, dvL = 0, dvH = 0;
            while(pos < 7) {
                if(tempFields[m][pos+dhL][8] !== 'X') dvL++;
                if(tempFields[m][size-1-(pos+dhH)][8] !== 'X') dvH++;
                if(tempFields[m][8][pos+dhL] !== 'X') dhL++;
                if(tempFields[m][8][size-1-(pos+dhH)] !== 'X') dhH++;
                
                tempFields[m][8][size-1-(pos+dvH)] = tempFields[m][pos+dvL][8] = ((format >> pos) & 1) ? 'D' : 'L'
                tempFields[m][8][pos+dhL] = tempFields[m][size-1-(pos+dvH)][8] = ((format >> (14-pos)) & 1) ? 'D' : 'L'
                pos++;
            }
            tempFields[m][8][8] = tempFields[m][8][size-8] = ((format >> 7) & 1) ? 'D' : 'L';
        })
        //this.print(document.body,tempFields[0]);
        let lowestPenality = Infinity;
        let bestPatternIdx = -1;
        tempFields.forEach((field, index) => {
            const penalty = this.calculatePenalities(field)
            if(penalty < lowestPenality) {
                lowestPenality = penalty
                bestPatternIdx = index;
            }
        });

        tempFields[bestPatternIdx].forEach((row,y) => {
            row.forEach((column,x) => {
                this.field[y][x] = column;
            })
        });
    }

    private calculatePenalities(field: QRField) {
        const N1 = 3;
        const N2 = 3;
        const N3 = 40;
        const N4 = 10;

        const qrSize = this.getSize();
        const penalityN1 = (f : QRField) => {
            let points = 0;
            let sameCountCol : number, sameCountRow : number;
            let lastCol : number, lastRow : number;

            for(let row = 0; row < qrSize; row++) {
                sameCountCol = sameCountRow = 0;
                
                for(let col = 0; col < qrSize; col++) {
                    let module = QRCode.isModuleDark(f[row][col]);
                    if(module === lastCol)
                        sameCountCol++;
                    else {
                        if(sameCountCol >= 5)
                            points += N1 + (sameCountCol - 5);
                        lastCol = module;
                        sameCountCol = 1;
                    }

                    module = QRCode.isModuleDark(f[col][row]);
                    if(module === lastRow)
                        sameCountRow++;
                    else {
                        if(sameCountRow >= 5)
                            points += N1 + (sameCountRow - 5);
                        lastRow = module;
                        sameCountRow = 1;
                    }
                }

                if (sameCountCol >= 5) points += N1 + (sameCountCol - 5)
                if (sameCountRow >= 5) points += N1 + (sameCountRow - 5)
            }

            return points;
        }

        const penalityN2 = (f: QRField) => {
            let points = 0;
            
            for(let row = 0; row < qrSize - 1; row++) {
                for(let col = 0; col < qrSize - 1; col++) {
                    const last = QRCode.isModuleDark(f[row][col]) + QRCode.isModuleDark(f[row][col + 1]) + QRCode.isModuleDark(f[row + 1][col]) + QRCode.isModuleDark(f[row + 1][col + 1]);

                    if(last === 4 || last === 0)
                        points++;
                }
            }

            return points * N2;
        }

        const penalityN3 = (f: QRField) => {
            let points = 0, bitsCol = 0, bitsRow = 0;

            for(let row = 0; row < qrSize; row++) {
                bitsCol = bitsRow = 0;
                for(let col = 0; col < qrSize; col++) {
                    bitsCol = ((bitsCol << 1) & 0x7FF) | QRCode.isModuleDark(f[row][col]);
                    if(col >= 10 && bitsCol === 0x5D0 || bitsCol === 0x05D)
                        points++;

                    bitsRow = ((bitsRow << 1) & 0x7FF) | QRCode.isModuleDark(f[col][row]);
                    if(row >= 10 && bitsRow === 0x5D0 || bitsRow === 0x05D)
                        points++;
                }
            }

            return points * N3;
        }

        const penalityN4 = (f: QRField) => {
            let darkCount = 0;
            const modulesCount = qrSize * qrSize;

            for(let row = 0; row < qrSize; row++) {
                for(let col = 0; col < qrSize; col++) {
                    darkCount += QRCode.isModuleDark(f[row][col]);
                }
            }

            const k = Math.abs(Math.ceil((darkCount * 100 / modulesCount) / 5) - 10);

            return k * N4;
        }

        return [penalityN1, penalityN2, penalityN3, penalityN4].reduce((sum, fn) => sum + fn(field), 0);
    }

    private static isModuleDark(module : QRModule) : number {
        if(module === 'D' || module === 1)
            return 1;
        if(module === 'L' || module === 0)
            return 0;
        return NaN;
    }

    //private writeFormatInfo

    private _debug(mode: number) : void {
        console.log("sjhfjsdhfdf");
        let table = document.createElement("table");
        this.field.forEach((row, r) => {
            let tr = table.appendChild(document.createElement('tr'));
            row.forEach((val,c) => {
                let td = tr.appendChild(document.createElement('td'));
                td.setAttribute('data-r',""+r);
                td.setAttribute('data-c',""+c);
                if(typeof val !== "number")
                    td.classList.add(val);
            });
        });

        if(!!(mode & QRCode.D_INPUT)) {
            const symbolSize = TransformationConfig[this.mode].symbolSize;
            const countIndicatorSize = TransformationConfig[this.mode].countIndicatorSize(this.version);

            const size = this.getSize();
            let upwards = true;
        
            let currentY = size-1, bPos = 0;
            for(let x = size-1; x > -1; x -= 2) {
                if(x === 6) x--; //TIMER (vertikal)
                for(let y = currentY; y > -1 && y < size; y = upwards ? y-1 : y+1) {
                    if(this.field[y][x] === 'X' && this.field[y][x-1] === 'X') {
                        upwards = !upwards;
                        currentY = upwards ? y-1 : y+1;
                        break;
                    }

                    for(let dx = 0; dx <= 1; dx++) {
                        if(typeof this.field[y][x-dx] === 'number') {
                            let cell : HTMLElement = table.querySelector("[data-r='"+y+"'][data-c='"+(x-dx)+"']");
                            if(bPos < 4 || bPos >= 4+countIndicatorSize+this._rawInput.length && bPos < 8+countIndicatorSize+this._rawInput.length) {//Terminator
                                cell.style.backgroundColor = this.bitStream[bPos] ? 'crimson' : 'lightcoral';
                            } else if(bPos < 4+countIndicatorSize) {//Count-Indicator
                                cell.style.backgroundColor = this.bitStream[bPos] ? 'limegreen' : 'lightgreen';
                            } else if(bPos < 4+countIndicatorSize+this._rawInput.length) {//Daten
                                let colors = DEBUGCOLORS[0][Math.floor((bPos - 4 - countIndicatorSize) / symbolSize) % 2];
                                cell.style.backgroundColor = this.bitStream[bPos] ? colors.true : colors.false;
                            } else if(bPos < Math.ceil(1+(countIndicatorSize+this._rawInput.length)/8)*8) { //mit 0 auffüllen
                                cell.style.backgroundColor = "grey";
                            } else if(bPos < this.nrOfDataCodeWords*8) { //PADDING 256,17
                                let colors = DEBUGCOLORS[1][Math.floor((bPos - Math.ceil(1+(countIndicatorSize+this._rawInput.length)/8)*8) / 8) % 2];
                                cell.style.backgroundColor = this.bitStream[bPos] ? colors.true : colors.false;
                            } else {
                                let colors = DEBUGCOLORS[2][Math.floor((bPos - Math.ceil(1+(countIndicatorSize+this._rawInput.length)/8)*8) / 8) % 2];
                                cell.style.backgroundColor = this.bitStream[bPos] ? colors.true : colors.false;
                            }
                            cell.textContent = this.bitStream[bPos++] ? '1' : '0';
                        }
                    }
                   
                    if(y === 0 && upwards || y === size - 1 && !upwards) {
                        upwards = !upwards;
                        currentY = y;
                        break;
                    }
                }
            }
        } else if(!!(mode & QRCode.D_BYTE)) {
            const size = this.getSize();
            let upwards = true;
        
            let currentY = size-1, bPos = 0;
            for(let x = size-1; x > -1; x -= 2) {
                if(x === 6) x--; //TIMER (vertikal)
                for(let y = currentY; y > -1 && y < size; y = upwards ? y-1 : y+1) {
                    if(this.field[y][x] === 'X' && this.field[y][x-1] === 'X') {
                        upwards = !upwards;
                        currentY = upwards ? y-1 : y+1;
                        break;
                    }

                    for(let dx = 0; dx <= 1; dx++) {
                        if(typeof this.field[y][x-dx] === 'number') {
                            let cell : HTMLElement = table.querySelector("[data-r='"+y+"'][data-c='"+(x-dx)+"']");
                            let colors = DEBUGCOLORS[bPos < this.nrOfDataCodeWords*8 ? 0 : 2][Math.floor(bPos / 8) % 2];
                            cell.style.backgroundColor = this.bitStream[bPos] ? colors.true : colors.false;
                            cell.textContent = this.bitStream[bPos++] ? '1' : '0';
                        }
                    }
                    
                    if(y === 0 && upwards || y === size - 1 && !upwards) {
                        upwards = !upwards;
                        currentY = y;
                        break;
                    }
                }
            }
        }

        document.body.appendChild(table);
    }

    private print(parent: HTMLElement, field?: ReturnType<() => QRCode['field']>) {
        if(!field)
            field = this.field;

        let table = parent.appendChild(document.createElement("table"))
        let size = this.getSize();
        //let out : any[] = [];
        //out.push(...Array.from(Array(size+2)).map(_ => 'background-color:white;font-size:17px;line-height:1'));
        field.forEach((row,y) => {
            let tr = table.appendChild(document.createElement("tr"));
            //out.push('background-color:white;font-size:17px;line-height:1');
            row.forEach((column,x) => {
                let td = tr.appendChild(document.createElement("td"));
                if(typeof column !== "number") {
                    td.classList.add(column);
                } else {
                    td.classList.add(column > 0 ? "G" : "R");
                    td.textContent = ""+column;
                }
                /*switch(column) {
                    case 'D':
                    case 1:
                        out.push('background-color:black;font-size:17px;line-height:1');
                        break;
                    case 'L':
                    case 0:
                        out.push('background-color:beige;font-size:17px;line-height:1');
                        break;
                    /*case 'X':
                        out.push('background-color:lightskyblue');
                        break;
                    case 1:
                        out.push('background-color:lightgreen');
                        break;
                    case 0:
                        out.push('background-color:lightcoral');/
                }*/
            })
            //out.push('background-color:white;font-size:17px;line-height:1');
        })
        //out.push(...Array.from(Array(size+2)).map(_ => 'background-color:white;font-size:17px;line-height:1'));
        //console.log(("%c  ".repeat(Math.sqrt(out.length))+"\n").repeat(Math.sqrt(out.length)), ...out);
    }
}

//module.exports = QRCode;