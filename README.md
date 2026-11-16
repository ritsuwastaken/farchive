# @ritsuwastaken/farchive

reader and writer for unreal engine 1, 2 and 3 binary data

## Usage

```bash
npm install @ritsuwastaken/farchive
```

```ts
import { Reader, Writer } from "@ritsuwastaken/farchive";

const reader = new Reader(bytes, { version: 123 });
const count = reader.index();
const names = Array.from({ length: count }, () => reader.nameEntry());

const writer = new Writer({ version: 123 });
writer.index(names.length);
for (const entry of names) writer.nameEntry(entry);
const out = writer.result();
```
