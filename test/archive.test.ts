import assert from "node:assert/strict";
import { test } from "node:test";
import { ArchiveError, decodeAnsi, Reader, versions, Writer } from "../src/index.ts";

const bytes = (write: (writer: Writer) => void, version?: number) => {
  const writer = new Writer({ version });
  write(writer);
  return writer.result();
};

const hex = (value: Uint8Array) => Buffer.from(value).toString("hex");

test("compact indexes match the engine encoding", () => {
  const cases: [number, string][] = [
    [0, "00"],
    [1, "01"],
    [-1, "81"],
    [63, "3f"],
    [64, "4001"],
    [-64, "c001"],
    [8191, "7f7f"],
    [8192, "408001"],
    [1048575, "7fff7f"],
    [1048576, "40808001"],
    [134217727, "7fffff7f"],
    [134217728, "4080808001"],
    [0x7fffffff, "7fffffff0f"],
    [-0x7fffffff, "ffffffff0f"],
  ];
  for (const [value, encoded] of cases) {
    assert.equal(hex(bytes((w) => w.compactIndex(value))), encoded, `write ${value}`);
    assert.equal(new Reader(Buffer.from(encoded, "hex")).compactIndex(), value, `read ${value}`);
  }
  assert.throws(() => new Writer().compactIndex(2 ** 31), /out of range/);
  assert.throws(() => new Reader(Buffer.from("40", "hex")).compactIndex(), ArchiveError);
});

test("indexes become 32-bit from version 178", () => {
  assert.equal(hex(bytes((w) => w.index(300), 177)), "6c04");
  assert.equal(hex(bytes((w) => w.index(300), versions.int32Indexes)), "2c010000");
  assert.equal(new Reader(Buffer.from("2c010000", "hex"), { version: 178 }).index(), 300);
});

test("strings are Latin-1 or UTF-16 with a terminator", () => {
  assert.equal(hex(bytes((w) => w.str(""))), "00");
  assert.equal(hex(bytes((w) => w.str("Ab"))), "03416200");
  assert.equal(hex(bytes((w) => w.str("café"))), "05636166e900");
  assert.equal(hex(bytes((w) => w.str("Я"))), "822f040000");
  for (const text of ["", "Ab", "café", "Я и ты", "x".repeat(300)]) {
    for (const version of [undefined, 127, 500]) {
      const reader = new Reader(bytes((w) => w.str(text), version), { version });
      assert.equal(reader.str(), text);
      assert.equal(reader.remaining, 0);
    }
  }
  assert.equal(new Reader(Buffer.from("0100", "hex")).str(), "");
  assert.throws(() => new Reader(Buffer.from("024142", "hex")).str(), /not terminated/);
});

test("name entries follow the package version", () => {
  const entry = { name: "None", flags: 0x70010n };
  assert.equal(hex(bytes((w) => w.nameEntry(entry), 61)), "4e6f6e650010000700");
  assert.equal(hex(bytes((w) => w.nameEntry(entry), 123)), "054e6f6e650010000700");
  assert.equal(hex(bytes((w) => w.nameEntry(entry), 200)), "050000004e6f6e65001000070000000000");
  for (const version of [61, 123, 200, 500]) assert.deepEqual(new Reader(bytes((w) => w.nameEntry(entry), version), { version }).nameEntry(), entry);
});

test("name references gain a number from version 343", () => {
  assert.equal(hex(bytes((w) => w.name(5), 123)), "05");
  assert.equal(hex(bytes((w) => w.name({ index: 5, number: 2 }), 343)), "0500000002000000");
  assert.deepEqual(new Reader(Buffer.from("0500000002000000", "hex"), { version: 343 }).name(), { index: 5, number: 2 });
  assert.deepEqual(new Reader(Buffer.from("05", "hex")).name(), { index: 5, number: 0 });
});

test("numbers, arrays and patches", () => {
  const out = bytes((w) => {
    w.u8(255);
    w.i16(-2);
    w.u32(0xdeadbeef);
    w.f32(1.5);
    w.i64(-3n);
    w.f64(Math.PI);
    w.array([1, 2, 3], (writer, value) => writer.i32(value));
    w.patchI32(1, 0x01020304);
  });
  const reader = new Reader(out);
  assert.equal(reader.u8(), 255);
  assert.equal(reader.u32(), 0x01020304);
  assert.equal(reader.u16(), 0xdead);
  assert.equal(reader.f32(), 1.5);
  assert.equal(reader.i64(), -3n);
  assert.equal(reader.f64(), Math.PI);
  assert.deepEqual(reader.array((r) => r.i32()), [1, 2, 3]);
  assert.ok(reader.atEnd);
  assert.throws(() => reader.u8(), /Unexpected end of data at offset/);
});

test("the writer grows", () => {
  const writer = new Writer();
  for (let i = 0; i < 5000; i++) {
    writer.u8(i & 0xff);
    writer.u32(i);
    writer.f64(i);
    writer.bytes(new Uint8Array([1, 2, 3]));
    writer.str("abc");
  }
  const reader = new Reader(writer.result());
  for (let i = 0; i < 5000; i++) {
    assert.equal(reader.u8(), i & 0xff);
    assert.equal(reader.u32(), i);
    assert.equal(reader.f64(), i);
    assert.deepEqual(reader.take(3), new Uint8Array([1, 2, 3]));
    assert.equal(reader.str(), "abc");
  }
});

test("8-bit text can be read in another code page", () => {
  assert.equal(decodeAnsi("// \xb0\xa1\xb3\xaa", "euc-kr"), "// 가나");
  assert.equal(decodeAnsi("\xcf\xf0\xe8\xe2\xe5\xf2", "windows-1251"), "Привет");
  assert.equal(decodeAnsi("plain", "euc-kr"), "plain");
  assert.equal(decodeAnsi("caf\xe9", "euc-kr"), null);
});
