import { ArchiveError } from "./error.ts";
import { usesCompactIndex, type ArchiveOptions, type NameEntry, type NameRef } from "./reader.ts";
import { versions } from "./versions.ts";

export class Writer {
  readonly version: number | undefined;
  readonly licensee: number | undefined;
  private buffer = new Uint8Array(1 << 12);
  private view = new DataView(this.buffer.buffer);
  length = 0;

  constructor(options: ArchiveOptions = {}) {
    this.version = options.version;
    this.licensee = options.licensee;
  }

  private reserve(size: number): number {
    const at = this.length;
    if (at + size > this.buffer.length) {
      let capacity = this.buffer.length * 2;
      while (capacity < at + size) capacity *= 2;
      const next = new Uint8Array(capacity);
      next.set(this.buffer.subarray(0, at));
      this.buffer = next;
      this.view = new DataView(next.buffer);
    }
    this.length += size;
    return at;
  }

  bytes(value: Uint8Array): void {
    const at = this.reserve(value.length);
    this.buffer.set(value, at);
  }

  u8(value: number): void {
    const at = this.reserve(1);
    this.view.setUint8(at, value);
  }

  i8(value: number): void {
    const at = this.reserve(1);
    this.view.setInt8(at, value);
  }

  u16(value: number): void {
    const at = this.reserve(2);
    this.view.setUint16(at, value, true);
  }

  i16(value: number): void {
    const at = this.reserve(2);
    this.view.setInt16(at, value, true);
  }

  u32(value: number): void {
    const at = this.reserve(4);
    this.view.setUint32(at, value >>> 0, true);
  }

  i32(value: number): void {
    const at = this.reserve(4);
    this.view.setInt32(at, value, true);
  }

  u64(value: bigint): void {
    const at = this.reserve(8);
    this.view.setBigUint64(at, value, true);
  }

  i64(value: bigint): void {
    const at = this.reserve(8);
    this.view.setBigInt64(at, value, true);
  }

  f32(value: number): void {
    const at = this.reserve(4);
    this.view.setFloat32(at, value, true);
  }

  f64(value: number): void {
    const at = this.reserve(8);
    this.view.setFloat64(at, value, true);
  }

  compactIndex(value: number): void {
    if (!Number.isInteger(value) || Math.abs(value) > 0x7fffffff) throw new ArchiveError(`Compact index out of range: ${value}`);
    let rest = Math.abs(value);
    const bytes = [(value < 0 ? 0x80 : 0) | (rest < 0x40 ? rest : (rest & 0x3f) | 0x40)];
    if (rest >= 0x40) {
      rest >>>= 6;
      let i = 1;
      for (; i < 4; i++) {
        bytes.push(rest < 0x80 ? rest : (rest & 0x7f) | 0x80);
        if (rest < 0x80) break;
        rest >>>= 7;
      }
      if (i === 4) bytes.push(rest);
    }
    this.bytes(Uint8Array.from(bytes));
  }

  index(value: number): void {
    if (usesCompactIndex(this.version)) this.compactIndex(value);
    else this.i32(value);
  }

  str(value: string): void {
    if (value === "") {
      this.index(0);
      return;
    }
    const wide = /[^\x00-\xff]/.test(value);
    const size = value.length + 1;
    this.index(wide ? -size : size);
    if (wide) {
      const at = this.reserve(size * 2);
      for (let i = 0; i < value.length; i++) this.view.setUint16(at + i * 2, value.charCodeAt(i), true);
      this.view.setUint16(at + value.length * 2, 0, true);
    } else {
      const at = this.reserve(size);
      for (let i = 0; i < value.length; i++) this.buffer[at + i] = value.charCodeAt(i);
      this.buffer[at + value.length] = 0;
    }
  }

  ansiz(value: string): void {
    if (/[^\x01-\xff]/.test(value)) throw new ArchiveError("A null-terminated string must be Latin-1 without zero characters");
    const at = this.reserve(value.length + 1);
    for (let i = 0; i < value.length; i++) this.buffer[at + i] = value.charCodeAt(i);
    this.buffer[at + value.length] = 0;
  }

  nameEntry(entry: NameEntry): void {
    if (this.version !== undefined && this.version < versions.lengthPrefixedNames) this.ansiz(entry.name);
    else this.str(entry.name);
    if (this.version !== undefined && this.version >= versions.wideNameFlags) this.u64(entry.flags);
    else this.u32(Number(entry.flags & 0xffffffffn));
  }

  name(ref: NameRef | number): void {
    const { index, number } = typeof ref === "number" ? { index: ref, number: 0 } : ref;
    this.index(index);
    if (this.version !== undefined && this.version >= versions.nameNumbers) this.i32(number);
  }

  guid(value: Uint8Array): void {
    if (value.length !== 16) throw new ArchiveError(`A GUID is 16 bytes, got ${value.length}`);
    this.bytes(value);
  }

  array<T>(values: readonly T[], write: (writer: this, value: T) => void): void {
    this.index(values.length);
    for (const value of values) write(this, value);
  }

  patchU32(at: number, value: number): void {
    this.view.setUint32(at, value >>> 0, true);
  }

  patchI32(at: number, value: number): void {
    this.view.setInt32(at, value, true);
  }

  result(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}
