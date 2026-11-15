export class ArchiveError extends Error {
  readonly offset: number;
  readonly detail: string;

  constructor(message: string, offset = -1) {
    super(offset >= 0 ? `${message} at offset ${offset}` : message);
    this.name = "ArchiveError";
    this.offset = offset;
    this.detail = message;
  }
}
