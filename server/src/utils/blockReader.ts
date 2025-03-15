import { promises as fs } from 'fs';
import { UTF8Validator } from './validators';

interface BlockReaderOptions {
  readonly blockSize: number;
  readonly memBuffer: number;
}

/**
 * Returns the expected UTF‑8 sequence length based on the first byte.
 */
function getUTF8SequenceLength(firstByte: number): number {
  if (firstByte < 0x80) return 1;
  else if ((firstByte & 0xe0) === 0xc0) return 2;
  else if ((firstByte & 0xf0) === 0xe0) return 3;
  else if ((firstByte & 0xf8) === 0xf0) return 4;
  // Fallback for invalid bytes.
  return 1;
}

function findLastValidUTF8Boundary(buffer: Buffer): number {
  const n = buffer.length;
  if (n === 0) return 0;

  // Start from the last byte and move backwards until you hit a non-continuation byte.
  let i = n - 1;
  while (i >= 0 && (buffer[i] & 0xc0) === 0x80) {
    i--;
  }
  // If we didn't find a lead byte (should not happen), throw an error.
  if (i < 0) {
    throw new Error('Invalid UTF-8 sequence detected');
  }

  const seqLength = getUTF8SequenceLength(buffer[i]);
  // If the bytes from i to the end are fewer than the expected length,
  // then the last character is incomplete.
  if (n - i < seqLength) {
    return i;
  }
  // Otherwise, everything is complete.
  return n;
}

interface BlockReaderOptions {
  readonly blockSize: number;
  readonly memBuffer: number;
}

export class ReverseBlockReader {
  private static readonly NEW_LINE = 0x0a;
  private leftover = Buffer.alloc(0);
  private fileBuffer: Buffer;
  private initialMtimeMs: number = 0;
  private curPosition: number = 0;
  private entriesRemaining: number = 0;
  private utf8Validator = new UTF8Validator();

  constructor(
    private readonly fileHandle: fs.FileHandle,
    private readonly numEntries?: number,
    private readonly search?: string,
    private options: BlockReaderOptions = {
      blockSize: 1024 * 1024,
      memBuffer: 10 * 1024 * 1024,
    }
  ) {
    this.fileBuffer = Buffer.alloc(this.options.blockSize);
    if (options.blockSize >= options.memBuffer) {
      throw new Error('blockSize must be less than memBuffer');
    }
  }

  private *processBlockWithNewline(
    readSize: number,
    newlinePos: number
  ): Generator<string> {
    // The part after the first newline and any previous leftover makes the current block.
    const linesBuffer = this.utf8Validator.validateUtf8Chunk(
      Buffer.concat([
        this.fileBuffer.subarray(newlinePos + 1, readSize),
        this.leftover,
      ])
    );
    // Save the part before the newline as the new leftover.
    this.leftover = Buffer.from(this.fileBuffer.subarray(0, newlinePos));
    const decoded = linesBuffer.toString('utf8').split('\n').reverse();
    let processedBlock = this.search
      ? decoded.filter((line) => line.includes(this.search!))
      : decoded.filter((line) => line.length);
    if (this.entriesRemaining < processedBlock.length) {
      processedBlock = processedBlock.slice(0, this.entriesRemaining);
    }
    this.entriesRemaining -= processedBlock.length;
    if (processedBlock.length) {
      yield processedBlock.join('\n') + '\n';
    }
  }

  /**
   * When no newline is found in the block and the accumulated leftover becomes too big,
   * scan further backwards until a newline is found or the file beginning is reached.
   * Then, optionally search the full line (if this.search is provided) and yield it in chunks.
   * Finally, update the read position (via overridePosition) so the main loop can continue correctly.
   */
  private async findNewlinePositionBackward(startPos: number): Promise<number> {
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

  private async reset(): Promise<void> {
    const stats = await this.fileHandle.stat();
    this.curPosition = stats.size;
    this.initialMtimeMs = stats.mtimeMs;
    this.entriesRemaining =
      this.numEntries === undefined ? Infinity : this.numEntries;
  }

  async *readBlocks(): AsyncGenerator<string> {
    await this.reset();
    while (this.curPosition > 0 && this.entriesRemaining > 0) {
      await this.checkFileIntegrity();
      const readSize = Math.min(this.options.blockSize, this.curPosition);
      this.curPosition -= readSize;
      await this.fileHandle.read(
        this.fileBuffer,
        0,
        readSize,
        this.curPosition
      );

      const newlinePos = this.fileBuffer
        .subarray(0, readSize)
        .indexOf(ReverseBlockReader.NEW_LINE);
      if (newlinePos === -1) {
        // No newline found; accumulate leftover bytes
        this.leftover = Buffer.concat([
          this.fileBuffer.subarray(0, readSize),
          this.leftover,
        ]);
        // If the leftover becomes too big, process it by scanning backwards for a newline.
        if (this.leftover.length > this.options.memBuffer) {
          yield* this.handleLargeLeftover(this.curPosition);
        }
      } else {
        yield* this.processBlockWithNewline(readSize, newlinePos);
      }
    }

    // Yield any final leftover if present
    if (
      this.leftover.length &&
      this.entriesRemaining > 0 &&
      (this.search === undefined || this.leftover.includes(this.search))
    ) {
      yield this.utf8Validator
        .validateUtf8Chunk(this.leftover)
        .toString('utf8') + '\n';
    }
  }

  private async *handleLargeLeftover(
    currentPosition: number
  ): AsyncGenerator<string> {
    const endPos = currentPosition + this.leftover.length;
    let tempBuffer = Buffer.alloc(0);
    this.leftover = Buffer.alloc(0);
    const startPos = await this.findNewlinePositionBackward(currentPosition);
    if (await this.streamingSearch(startPos, endPos)) {
      let pos = startPos;
      while (endPos > pos) {
        const readSize = Math.min(this.options.blockSize, endPos - pos);
        await this.fileHandle.read(this.fileBuffer, 0, readSize, pos);
        const combined = Buffer.concat([
          tempBuffer,
          this.fileBuffer.subarray(0, readSize),
        ]);
        const validBoundary = findLastValidUTF8Boundary(combined);
        const completeChunk = combined.subarray(0, validBoundary);
        tempBuffer = combined.subarray(validBoundary);
        yield this.utf8Validator
          .validateUtf8Chunk(completeChunk, true)
          .toString('utf8');
        pos += readSize;
      }
      this.curPosition = Math.max(startPos - 1, 0);
      this.entriesRemaining -= 1;
      this.utf8Validator.finalizeValidation();
      yield '\n';
    }
  }

  /**
   * Performs a streaming search for the search term between startPos and endPos.
   * Returns true if the term is found, false otherwise.
   */
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
      const chunkSize = Math.min(this.options.blockSize, endPos - currentPos);
      const chunk = Buffer.alloc(chunkSize);
      await this.fileHandle.read(chunk, 0, chunkSize, currentPos);

      const combined = Buffer.concat([searchBuffer, chunk]).toString('utf8');
      if (combined.includes(this.search)) {
        return true;
      }

      // Keep the last (termLength - 1) bytes for overlap
      searchBuffer = Buffer.from(
        chunk.subarray(-Math.max(0, Buffer.byteLength(this.search) - 1))
      );
      currentPos += chunkSize;
    }
    return false;
  }
  private async checkFileIntegrity(): Promise<void> {
    const currentStats = await this.fileHandle.stat();
    if (currentStats.mtimeMs > this.initialMtimeMs) {
      throw new Error('File modified during reading');
    }
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
    const blockReader = new ReverseBlockReader(fileHandle, numEntries, search);
    yield* blockReader.readBlocks();
  } catch (error) {
    throw new Error(`Error reading file`);
  } finally {
    if (fileHandle) {
      await fileHandle.close().catch(() => {
        console.error('Error closing file handle');
      });
    }
  }
}
