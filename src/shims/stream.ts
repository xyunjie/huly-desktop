/** Minimal stand-in for Node's `stream`, which the storage helper imports but phase 1 does not call. */
export class Readable {
  static from(source: unknown): unknown {
    return source;
  }
}

export default { Readable };
