export type LayoutFormat = {
  text: {
    value: TextFormat,
    valueAsWord?: TextFormat,
    number: TextFormat,
    date: TextFormat,
    dateUntil?: TextFormat
  },
  validity?: {
    date?: string, //yyyy-mm-dd
    range?: string, //##d || ##y
  }
  code: CodeFormat,
  fonts?: Fonts
}

export type TextFormat = {
    position?: [number,number],
    size?: number,
    font? : string
    color?: string,
    anchorX?: 'left' | 'center' | 'right',
    anchorY?: 'top' | 'middle' | 'bottom'
}

export type CodeFormat = {
    position?: [number,number],
    size?: number,
    padding?: number,
    color?: string,
    background?: string
}

type Fonts = {
    [key: string]: string
}