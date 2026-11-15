import { compactIndex as compact, guidSize, maxIndex } from "./constants.ts";
import { ArchiveError } from "./error.ts";
import { versions } from "./versions.ts";

export interface ArchiveOptions {
  version?: number;
  licensee?: number;
}

export interface NameEntry {
  name: string;
  flags: bigint;
}

export interface NameRef {
  index: number;
  number: number;
}

const latin1 = new TextDecoder("latin1");
const utf16 = new TextDecoder("utf-16le");

export const usesCompactIndex = (version: number | undefined) => version === undefined || version < versions.int32Indexes;

export class Reader {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  readonly version: number | undefined;
  readonly licensee: number | undefined;
  offset: number;

  constructor(bytes: Uint8Array, options: ArchiveOptions & { offset?: number } = {}) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.version = options.version;
    this.licensee = options.licensee;
    this.offset = options.offset ?? 0;
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  get atEnd(): boolean {
    return this.offset >= this.bytes.length;
  }

  need(size: number): void {
    if (size < 0 || this.offset + size > this.bytes.length) throw new ArchiveError("Unexpected end of data", this.offset);
  }

  seek(offset: number): void {
    if (offset < 0 || offset > this.bytes.length) throw new ArchiveError(`Cannot seek to ${offset}`, this.offset);
    this.offset = offset;
  }

  skip(size: number): void {
    this.need(size);
    this.offset += size;
  }

  take(size: number): Uint8Array {
    this.need(size);
    const value = this.bytes.slice(this.offset, this.offset + size);
    this.offset += size;
    return value;
  }

  private advance(size: number): number {
    this.need(size);
    const at = this.offset;
    this.offset += size;
    return at;
  }

  u8(): number {
    return this.view.getUint8(this.advance(1));
  }

  i8(): number {
    return this.view.getInt8(this.advance(1));
  }

  u16(): number {
    return this.view.getUint16(this.advance(2), true);
  }

  i16(): number {
    return this.view.getInt16(this.advance(2), true);
  }

  u32(): number {
    return this.view.getUint32(this.advance(4), true);
  }

  i32(): number {
    return this.view.getInt32(this.advance(4), true);
  }

  u64(): bigint {
    return this.view.getBigUint64(this.advance(8), true);
  }

  i64(): bigint {
    return this.view.getBigInt64(this.advance(8), true);
  }

  f32(): number {
    return this.view.getFloat32(this.advance(4), true);
  }

  f64(): number {
    return this.view.getFloat64(this.advance(8), true);
  }

  compactIndex(): number {
    const start = this.offset;
    const first = this.u8();
    let value = first & compact.firstMask;
    if (first & compact.firstHasMore) {
      let shift = compact.firstBits;
      for (let i = 1; i < compact.maxSize; i++) {
        const byte = this.u8();
        if (i === compact.maxSize - 1) {
          value += byte * 2 ** shift;
          break;
        }
        value += (byte & compact.mask) * 2 ** shift;
        shift += compact.bits;
        if (!(byte & compact.hasMore)) break;
      }
    }
    if (value > maxIndex) throw new ArchiveError("Compact index out of range", start);
    return first & compact.negative ? -value : value;
  }

  index(): number {
    return usesCompactIndex(this.version) ? this.compactIndex() : this.i32();
  }

  str(): string {
    const start = this.offset;
    const length = this.index();
    if (length === 0) return "";
    const wide = length < 0;
    const size = wide ? -length * 2 : length;
    this.need(size);
    const end = this.offset + size;
    const terminated = wide ? this.bytes[end - 2] === 0 && this.bytes[end - 1] === 0 : this.bytes[end - 1] === 0;
    if (!terminated) throw new ArchiveError("String is not terminated", start);
    const text = (wide ? utf16 : latin1).decode(this.bytes.subarray(this.offset, end - (wide ? 2 : 1)));
    this.offset = end;
    return text;
  }

  ansiz(): string {
    const end = this.bytes.indexOf(0, this.offset);
    if (end < 0) throw new ArchiveError("String is not terminated", this.offset);
    const text = latin1.decode(this.bytes.subarray(this.offset, end));
    this.offset = end + 1;
    return text;
  }

  nameEntry(): NameEntry {
    const name = this.version !== undefined && this.version < versions.lengthPrefixedNames ? this.ansiz() : this.str();
    const flags = this.version !== undefined && this.version >= versions.wideNameFlags ? this.u64() : BigInt(this.u32());
    return { name, flags };
  }

  name(): NameRef {
    const index = this.index();
    const number = this.version !== undefined && this.version >= versions.nameNumbers ? this.i32() : 0;
    return { index, number };
  }

  guid(): Uint8Array {
    return this.take(guidSize);
  }

  array<T>(read: (reader: this) => T): T[] {
    const at = this.offset;
    const count = this.index();
    if (count < 0 || count > this.remaining) throw new ArchiveError(`Invalid array length ${count}`, at);
    return Array.from({ length: count }, () => read(this));
  }
}
