const maxAnsi = 0xff;

export const isAnsi = (text: string): boolean => !/[^\x00-\xff]/.test(text);

export const ansiBytes = (text: string): Uint8Array => {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > maxAnsi) throw new RangeError(`Not an 8-bit string: ${JSON.stringify(text[i])}`);
    bytes[i] = code;
  }
  return bytes;
};

export const decodeAnsi = (text: string, encoding: string): string | null => {
  if (!/[\x80-\xff]/.test(text)) return text;
  if (!isAnsi(text)) return null;
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(ansiBytes(text));
  } catch {
    return null;
  }
};
