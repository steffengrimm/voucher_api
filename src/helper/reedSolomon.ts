class GaloisField {
    private static instance : GaloisField;

    private exponential : Map<number,number> = new Map();
    private logarithmic: Map<number,number> = new Map();

    private constructor() {
        let a = 1;
        for(let i = 0; i < 0x100; i++) {
            this.exponential.set(i,a);
            this.logarithmic.set(a,i);
            a <<= 1;
            if(a & 0x100) a ^= 0x11d;
        }
        this.logarithmic.set(this.exponential.get(0xff),0xff);
    }

    public static getInstance() {
        if(!this.instance)
            this.instance = new this();
        return this.instance;
    }

    public debug() {
        console.log(this.generatorPolynomial(13));
    }

    public multiply(a : number, b : number) : number {
        if(a === 0 || b === 0)
            return 0;
        return this.exponential.get(GaloisField.mod(this.logarithmic.get(a)+this.logarithmic.get(b),0xff));
    }

    public polynomialMultiply(p : number[], q: number[]) {
        const r : number[] = [];
        for(let j = 0; j < q.length; j++) {
            for(let i = 0; i < p.length; i++) {
                r[i+j] = (r[i+j] ?? 0) ^ this.multiply(p[i],q[j]);
            }
        }
        return r;
    }

    public generatorPolynomial(num: number) {
        let g = [1];
        for(let i = 0; i < num; i++) {
            g = this.polynomialMultiply(g, [1, this.exponential.get(GaloisField.mod(i,0xff))]);
        }
        return g;
    }

    private static mod(a : number, b : number) : number {
        return ((a%b)+b)%b;
    }
}

const galois = GaloisField.getInstance();
export function encodeMessage(msg : number[], num: number) : number[] {
    const generator = galois.generatorPolynomial(num);
    let msgOut = Array.from(msg);
    for(let i = 0; i < msg.length; i++) {
        const coefficient = msgOut[i];
        if(coefficient > 0) {
            for(let j = 0; j < generator.length; j++) {
                msgOut[i+j] = (msgOut[i+j] ?? 0) ^ galois.multiply(generator[j], coefficient);
            }
        }
    }
    return msgOut.slice(msg.length);
}

///////////////////////////////////

function ld(x : number) {
    return 1+Math.floor(Math.log2(x));
}

export function bchLongDivisionReminder(dividend: number, divisor: number) {
    let lsh, result = dividend;
    while((lsh = ld(result)-ld(divisor)) >= 0)
        result ^= divisor << lsh;

    return result;
}