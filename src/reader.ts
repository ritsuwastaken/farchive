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
  readonly view: DataView;
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

  private fixed<T>(size: number, read: (at: number) => T): T {
    this.need(size);
    const value = read(this.offset);
    this.offset += size;
    return value;
  }

  u8 = (): number => this.fixed(1, (at) => this.view.getUint8(at));
  i8 = (): number => this.fixed(1, (at) => this.view.getInt8(at));
  u16 = (): number => this.fixed(2, (at) => this.view.getUint16(at, true));
  i16 = (): number => this.fixed(2, (at) => this.view.getInt16(at, true));
  u32 = (): number => this.fixed(4, (at) => this.view.getUint32(at, true));
  i32 = (): number => this.fixed(4, (at) => this.view.getInt32(at, true));
  u64 = (): bigint => this.fixed(8, (at) => this.view.getBigUint64(at, true));
  i64 = (): bigint => this.fixed(8, (at) => this.view.getBigInt64(at, true));
  f32 = (): number => this.fixed(4, (at) => this.view.getFloat32(at, true));
  f64 = (): number => this.fixed(8, (at) => this.view.getFloat64(at, true));

  compactIndex(): number {
    const start = this.offset;
    const b0 = this.u8();
    let value = b0 & 0x3f;
    if (b0 & 0x40) {
      let shift = 6;
      for (let i = 1; i < 5; i++) {
        const byte = this.u8();
        if (i === 4) {
          value += byte * 2 ** shift;
          break;
        }
        value += (byte & 0x7f) * 2 ** shift;
        shift += 7;
        if (!(byte & 0x80)) break;
      }
    }
    if (value > 0x7fffffff) throw new ArchiveError("Compact index out of range", start);
    return b0 & 0x80 ? -value : value;
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
    return this.take(16);
  }

  array<T>(read: (reader: this) => T): T[] {
    const at = this.offset;
    const count = this.index();
    if (count < 0 || count > this.remaining) throw new ArchiveError(`Invalid array length ${count}`, at);
    return Array.from({ length: count }, () => read(this));
  }
}
