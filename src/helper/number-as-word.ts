const CONNECTOR = 'und';
const HUNDRED = 'hundert';
const POWER = ['tausend',[' Million ',' Millionen '],[' Milliarde ',' Milliarden ']];
const ONES = ['null',['eins','ein','eine'],'zwei','drei','vier','fünf','sechs','sieben','acht','neun','zehn','elf','zwölf','dreizehn','vierzehn','fünfzehn','sechzehn','siebzehn','achtzehn','neunzehn'];
const TENS = ['zwanzig','dreißig','vierzig','fünfzig','sechzig','siebzig','achtzig','neunzig']

/*const [integer,fraction] = (''+number).replace(',','.').split('.').map(part => part.split('').reverse().map(c => {
  	let num = parseInt(c);
    if(isNaN(num))
        throw Error("input isn't a number");
    return num;
  }));*/

export function numberAsWord(number: string | number, asCardinal = false) {
    const parsed = parseInt('' + number);
    if (isNaN(parsed))
        throw Error("input isn't a number");
    const integer = ('' + parsed).split('').reverse().map(c => parseInt(c));

    const intWord: string[] = [];
    for (let i = 0; i < integer.length; i++) {
        if (i % 3 === 0) {
            const d1 = integer[i + 1] ?? 0; //ten's digit
            const d0 = integer[i]; //one's digit
            const d = d1 * 10 + d0;

            const p = Math.floor(i / 3); //power
            if (p > 0 && d > 0) {
                let word = POWER[p - 1];
                if (Array.isArray(word))
                    word = word[d > 1 ? 1 : 0]
                intWord.push(word);
            }
            if (d1 <= 1) {
                if (p > 1 && d === 1) {
                    intWord.push(ONES[1][2])
                } else if(d > 0) {
                    let word = ONES[d];
                    if (Array.isArray(word))
                        word = word[i > 0 || !asCardinal ? 1 : 0];
                    intWord.push(word);
                }
            } else {
                intWord.push(TENS[d1 - 2]);
                if (d0 > 0) {
                    intWord.push(CONNECTOR);
                    let word = ONES[d0];
                    if (Array.isArray(word))
                        word = word[1];
                    intWord.push(word);
                }
            }
            i++;
        } else {
            const d = integer[i]; // hundred's digit
            if (d > 0) {
                let word = ONES[d];
                if (Array.isArray(word))
                    word = word[1];
                intWord.push(HUNDRED);
                intWord.push(word);
            }
        }
    }
    return intWord.reverse().join('');
}