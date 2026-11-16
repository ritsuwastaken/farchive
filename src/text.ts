export const isAnsi = (text: string): boolean => !/[^\x00-\xff]/.test(text);
