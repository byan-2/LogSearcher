import { promises as fs } from 'fs';
import { StringDecoder } from 'string_decoder';

class UTF8StreamDecoder {
  private decoder = new TextDecoder('utf-8', { fatal: true });
  private stringDecoder = new StringDecoder('utf8');
  // validate chunks using TextDecoder with streaming enabled, stream the chunks to StringDecoder to get the utf8 string.
  getUtf8Chunk(chunk: Buffer, stream = false): string {
    try {
      this.decoder.decode(chunk, { stream });
      return this.stringDecoder.write(chunk);
    } catch (e) {
      throw new Error('Invalid UTF-8 sequence detected');
    }
  }

  // flush remaining data
  finalizeChunk(): string {
    try {
      this.decoder.decode();
      return this.stringDecoder.end();
    } catch (e) {
      throw new Error('Incomplete UTF-8 data at end of stream');
    }
  }
}

interface BlockReaderOptions {
  readonly blockSize: number;
  readonly memBuffer: number;
}

export class ReverseBlockReader {
  private static readonly NEW_LINE = 0x0a;
  private leftover = Buffer.alloc(0);
  private fileBuffer: Buffer = Buffer.alloc(0);
  private initialMtimeMs: number = 0;
  private curPosition: number = 0;
  private entriesRemaining: number = 0;
  private streamDecoder = new UTF8StreamDecoder();

  constructor(
    private readonly fileHandle: fs.FileHandle,
    private readonly numEntries?: number,
    private readonly search?: string,
    private options: BlockReaderOptions = {
      blockSize: 1024 * 1024,
      memBuffer: 10 * 1024 * 1024,
    }
  ) {
    if (options.blockSize >= options.memBuffer) {
      throw new Error('blockSize must be less than memBuffer');
    }
  }

  private async setup(): Promise<void> {
    try {
      const stats = await this.fileHandle.stat();
      this.curPosition = stats.size;
      this.initialMtimeMs = stats.mtimeMs;
      this.fileBuffer = Buffer.alloc(
        Math.min(this.options.blockSize, stats.size)
      );
      this.entriesRemaining =
        this.numEntries === undefined ? Infinity : this.numEntries;
    } catch (err) {
      throw new Error('Error resetting file state');
    }
  }

  private async readIntoBuffer(
    readSize: number,
    position: number,
    fileBuffer: Buffer = this.fileBuffer
  ): Promise<void> {
    try {
      const currentStats = await this.fileHandle.stat();
      if (currentStats.mtimeMs > this.initialMtimeMs) {
        throw new Error('File modified during reading');
      }
      await this.fileHandle.read(fileBuffer, 0, readSize, position);
    } catch (err) {
      throw new Error('Error reading file into buffer');
    }
  }

  async *readBlocks(): AsyncGenerator<string> {
    await this.setup();
    while (this.curPosition > 0 && this.entriesRemaining > 0) {
      const readSize = Math.min(this.options.blockSize, this.curPosition);
      this.curPosition -= readSize;
      await this.readIntoBuffer(readSize, this.curPosition);
      const newlinePos = this.fileBuffer
        .subarray(0, readSize)
        .indexOf(ReverseBlockReader.NEW_LINE);
      if (newlinePos === -1) {
        // no newline found; accumulate leftover bytes
        this.leftover = Buffer.concat([
          this.fileBuffer.subarray(0, readSize),
          this.leftover,
        ]);
        // if the leftover becomes too big, process it by scanning backwards for a newline.
        if (this.leftover.length > this.options.memBuffer) {
          yield* this.handleLargeLeftover(this.curPosition);
        }
      } else {
        yield* this.processBlock(readSize, newlinePos);
      }
    }

    // yield any final leftover if present
    if (
      this.leftover.length &&
      this.entriesRemaining > 0 &&
      (this.search === undefined || this.leftover.includes(this.search))
    ) {
      yield this.streamDecoder.getUtf8Chunk(this.leftover) + '\n';
    }
  }

  private *processBlock(
    readSize: number,
    newlinePos: number
  ): Generator<string> {
    // the part after the first newline and any previous leftover makes the current block.
    const lines = this.streamDecoder.getUtf8Chunk(
      Buffer.concat([
        this.fileBuffer.subarray(newlinePos + 1, readSize),
        this.leftover,
      ])
    );
    // save the part before the newline as the new leftover.
    this.leftover = Buffer.from(this.fileBuffer.subarray(0, newlinePos));
    const decoded = lines.split('\n').reverse();
    let processedBlock = this.search
      ? decoded.filter((line) => line.includes(this.search!))
      : decoded.filter((line) => line.trim().length);
    if (this.entriesRemaining < processedBlock.length) {
      processedBlock = processedBlock.slice(0, this.entriesRemaining);
    }
    this.entriesRemaining -= processedBlock.length;
    if (processedBlock.length) {
      yield processedBlock.join('\n') + '\n';
    }
  }

  // finds the position of the first encountered newline character before startPos.
  private async findLineStart(startPos: number): Promise<number> {
    let position = startPos;

    while (position > 0) {
      const readSize = Math.min(this.options.blockSize, position);
      position -= readSize;
      await this.fileHandle.read(this.fileBuffer, 0, readSize, position);
      const newlinePos = this.fileBuffer.indexOf(ReverseBlockReader.NEW_LINE);
      if (newlinePos !== -1) {
        return position + newlinePos + 1;
      }
    }
    return 0;
  }

  private async *handleLargeLeftover(
    currentPosition: number
  ): AsyncGenerator<string> {
    const endPos = currentPosition + this.leftover.length;
    this.leftover = Buffer.alloc(0);
    const startPos = await this.findLineStart(currentPosition);
    if (await this.streamingSearch(startPos, endPos)) {
      let pos = startPos;
      while (endPos > pos) {
        const readSize = Math.min(this.options.blockSize, endPos - pos);
        await this.readIntoBuffer(readSize, pos);
        yield this.streamDecoder.getUtf8Chunk(
          this.fileBuffer.subarray(0, readSize),
          true
        );
        pos += readSize;
      }
      this.entriesRemaining -= 1;
      yield this.streamDecoder.finalizeChunk() + '\n';
    }
    this.curPosition = Math.max(startPos - 1, 0);
  }

  // performs a streaming search for the search term between startPos and endPos.
  private async streamingSearch(
    startPos: number,
    endPos: number
  ): Promise<boolean> {
    if (this.search === undefined) {
      return true;
    }
    let searchBuffer = Buffer.alloc(0);
    let currentPos = startPos;

    while (currentPos < endPos) {
      const readSize = Math.min(this.options.blockSize, endPos - currentPos);
      const chunk = Buffer.alloc(readSize);
      await this.readIntoBuffer(readSize, currentPos, chunk);
      const combined = Buffer.concat([searchBuffer, chunk]).toString('utf8');
      if (combined.includes(this.search)) {
        return true;
      }

      // keep the last (bytelength - 1) bytes for overlap
      searchBuffer = Buffer.from(
        chunk.subarray(-Math.max(0, Buffer.byteLength(this.search) - 1))
      );
      currentPos += readSize;
    }
    return false;
  }
}

export async function* generateLines(
  filePath: string,
  numEntries?: number,
  search?: string
): AsyncGenerator<string> {
  let fileHandle: fs.FileHandle | undefined;
  try {
    fileHandle = await fs.open(filePath, 'r');
  } catch (err) {
    throw new Error('Error opening file');
  }

  try {
    const blockReader = new ReverseBlockReader(fileHandle, numEntries, search);
    yield* blockReader.readBlocks(); // let errors here propagate unaltered
  } finally {
    if (fileHandle) {
      await fileHandle.close().catch(() => {
        console.error('Error closing file handle');
      });
    }
  }
}
