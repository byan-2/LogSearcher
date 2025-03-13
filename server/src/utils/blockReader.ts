import { promises as fs } from 'fs';

export class ReverseBlockReader {
  private initialSize!: number;
  private initialMtimeMs!: number;
  private leftover = Buffer.alloc(0);
  private buffer: Buffer;
  private entriesRemaining: number = 0;
  // Used only in handleLargeLeftover to update the read position externally.
  private overridePosition?: number;

  constructor(
    private readonly fileHandle: fs.FileHandle,
    private readonly fileSize: number,
    private readonly numEntries?: number,
    private readonly search?: string,
    private readonly blockSize: number = 1024 * 1024,
    private readonly maxInMemoryLeftover = 10 * 1024 * 1024
  ) {
    this.buffer = Buffer.alloc(this.blockSize);
  }

  private consumeOverridePosition(): number | undefined {
    const pos = this.overridePosition;
    this.overridePosition = undefined;
    return pos;
  }

  private validateText(text: string): void {
    if (text.includes('\ufffd')) {
      throw new Error('Unsupported or binary data detected.');
    }
  }

  /**
   * Process a block that contains at least one newline. It uses the data
   * after the first newline (plus any accumulated leftover) to form a string,
   * splits it into lines (reversed order), and applies any search filter.
   */
  private async *processBlockWithNewline(
    readSize: number,
    newlinePos: number
  ): AsyncGenerator<string> {
    // The part after the first newline and any previous leftover makes the current block.
    const linesBuffer = Buffer.concat([
      this.buffer.subarray(newlinePos + 1, readSize),
      this.leftover,
    ]);
    // Save the part before the newline as the new leftover.
    this.leftover = Buffer.from(this.buffer.subarray(0, newlinePos));
    let decoded = linesBuffer.toString('utf8');
    this.validateText(decoded);
    let result = decoded.split('\n').reverse();
    let processedBlock = this.search
      ? result.filter((line) => line.includes(this.search!))
      : result.filter((line) => line.length);
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
      const readSize = Math.min(this.blockSize, position);
      position -= readSize;

      await this.fileHandle.read(this.buffer, 0, readSize, position);
      const newlinePos = this.buffer.indexOf(0x0a);

      if (newlinePos !== -1) {
        return position + newlinePos + 1;
      }
    }

    return 0;
  }

  async *readBlocks(): AsyncGenerator<string> {
    const stats = await this.fileHandle.stat();
    let position = this.fileSize;
    this.initialSize = stats.size;
    this.initialMtimeMs = stats.mtimeMs;
    this.entriesRemaining =
      this.numEntries === undefined ? Infinity : this.numEntries;
    this.leftover = Buffer.alloc(0);

    while (position > 0 && this.entriesRemaining > 0) {
      await this.checkFileIntegrity();
      const readSize = Math.min(this.blockSize, position);
      position -= readSize;
      await this.fileHandle.read(this.buffer, 0, readSize, position);

      // Look for a newline in the current block
      const newlinePos = this.buffer.subarray(0, readSize).indexOf(0x0a);
      if (newlinePos === -1) {
        // No newline found; accumulate leftover bytes
        this.leftover = Buffer.concat([
          this.buffer.subarray(0, readSize),
          this.leftover,
        ]);

        if (this.leftover.length > this.maxInMemoryLeftover) {
          // If the leftover becomes too big, process it by scanning backwards for a newline.
          yield* this.handleLargeLeftover(position);
          const overriddenPosition = this.consumeOverridePosition();
          if (overriddenPosition !== undefined) {
            position = overriddenPosition;
          }
        }
      } else {
        // Process block when a newline is found.
        yield* this.processBlockWithNewline(readSize, newlinePos);
      }
    }

    // Yield any final leftover if present
    if (
      this.leftover.length &&
      this.entriesRemaining > 0 &&
      (!this.search || this.leftover.includes(this.search))
    ) {
      const finalText = this.leftover.toString('utf8');
      this.validateText(finalText);
      yield finalText + '\n';
    }
  }

  private async *handleLargeLeftover(
    currentPosition: number
  ): AsyncGenerator<string> {
    const endPos = currentPosition + this.leftover.length;
    this.leftover = Buffer.alloc(0);
    const startPos = await this.findNewlinePositionBackward(currentPosition);
    let shouldYield = true;
    if (this.search) {
      shouldYield = await this.streamingSearch(startPos, endPos);
    }
    this.overridePosition = startPos - 1;

    if (shouldYield) {
      let pos = startPos;
      while (endPos > pos) {
        const chunkSize = Math.min(this.blockSize, endPos - pos);
        await this.fileHandle.read(this.buffer, 0, chunkSize, pos);
        const chunkText = this.buffer.subarray(0, chunkSize).toString('utf8');
        this.validateText(chunkText);
        yield chunkText;
        pos += chunkSize;
      }
      yield '\n';
      this.entriesRemaining -= 1;
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
    const searchTerm = this.search!;
    const termLength = searchTerm.length;
    let searchBuffer = Buffer.alloc(0);
    let currentPos = startPos;

    while (currentPos < endPos) {
      const chunkSize = Math.min(this.blockSize, endPos - currentPos);
      const chunk = Buffer.alloc(chunkSize);
      await this.fileHandle.read(chunk, 0, chunkSize, currentPos);

      const combined = Buffer.concat([searchBuffer, chunk]).toString('utf8');
      this.validateText(combined);
      if (combined.includes(searchTerm)) {
        return true;
      }

      // Keep the last (termLength - 1) bytes for overlap
      searchBuffer = Buffer.from(chunk.subarray(-Math.max(0, termLength - 1)));
      currentPos += chunkSize;
    }

    return false;
  }
  private async checkFileIntegrity(): Promise<void> {
    const currentStats = await this.fileHandle.stat();

    if (currentStats.size < this.initialSize) {
      throw new Error('File truncated during reading');
    }

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
    const { size } = await fileHandle.stat();
    const blockReader = new ReverseBlockReader(
      fileHandle,
      size,
      numEntries,
      search
    );
    for await (const block of blockReader.readBlocks()) {
      yield block;
    }
  } finally {
    if (fileHandle) {
      await fileHandle.close().catch(() => {
        console.error('Error closing file handle');
      });
    }
  }
}
