export const safeJSONParse = (input: string) => {
    try {
      return JSON.parse(input);
    } catch(e) {
      return {} as any;
    }
}