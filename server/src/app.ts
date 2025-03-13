import express from 'express';
import fs from 'fs/promises';
import { Request, Response, NextFunction } from 'express';
import path from 'path';
import { Readable } from 'stream';

const app = express();

const BASE_DIR =
  process.env.NODE_ENV === 'test'
    ? path.join(__dirname, '..', 'test', 'logs')
    : '/var/log';
const PORT = process.env.PORT || 3000;
const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error(error);
  res.status(500).send({ message: error.message });
};

interface FileQuery {
  filename?: string;
  entries?: string;
  search?: string;
}

class ReverseBlockReader {
  private leftover = Buffer.allocUnsafe(0);
  private buffer: Buffer = Buffer.allocUnsafe(this.blockSize);

  constructor(
    private readonly fileHandle: fs.FileHandle,
    private readonly fileSize: number,
    private readonly blockSize: number = 1024 * 1024
  ) {}

  async *readBlocks(): AsyncGenerator<string[]> {
    let position = this.fileSize;

    while (position > 0) {
      const readSize = Math.min(this.blockSize, position);
      position -= readSize;
      await this.fileHandle.read(this.buffer, 0, readSize, position);
      yield this.processBlock(this.buffer.subarray(0, readSize));
    }
    if (this.leftover.length > 0) {
      yield [this.leftover.toString('utf-8')];
    }
  }

  private processBlock(block: Buffer): string[] {
    const combined = this.leftover.length
      ? Buffer.concat([block, this.leftover])
      : block;
    const newlinePos = combined.indexOf(0x0a);

    if (newlinePos === -1) {
      this.leftover = combined;
      return [];
    }

    this.leftover = combined.subarray(0, newlinePos);
    const linesBuffer = combined.subarray(newlinePos + 1);
    const lines = linesBuffer.toString('utf8').split('\n').reverse();
    return lines;
  }
}

// Async generator function that yields lines from the file
async function* generateLines(
  filePath: string,
  numEntries?: number,
  search?: string
): AsyncGenerator<string> {
  let fileHandle;
  try {
    fileHandle = await fs.open(filePath, 'r');
    const { size } = await fileHandle.stat();
    const blockReader = new ReverseBlockReader(fileHandle, size);
    let count = 0;
    for await (let block of blockReader.readBlocks()) {
      const shouldContinue = numEntries === undefined || count < numEntries;
      if (!shouldContinue) break;
      if (search) {
        block = block.filter((line) => line.includes(search));
      } else {
        block = block.filter((line) => line.length > 0);
      }
      const batchSize = 1000;
      for (let i = 0; i < block.length; i += batchSize) {
        if (!shouldContinue) break;
        yield block.slice(i, i + batchSize).join('\n') + '\n';
        count += Math.min(batchSize, block.length - i);
      }
    }
  } finally {
    if (fileHandle) {
      await fileHandle.close().catch(() => {});
    }
  }
}

// Express endpoint using Readable.from() to create a stream from the async generator
app.get(
  '/file',
  async (
    req: Request<{}, {}, {}, FileQuery>,
    res: Response,
    next: NextFunction
  ) => {
    const startTime = process.hrtime();

    try {
      const { filename, entries, search } = req.query;
      if (!filename) {
        throw new Error('Filename is required');
      }
      const numEntries = entries ? parseInt(entries, 10) : undefined;
      const filePath = path.join(BASE_DIR, filename);
      const linesStream = Readable.from(
        generateLines(filePath, numEntries, search)
      );
      res.setHeader('Content-Type', 'text/plain');

      linesStream.pipe(res);
      linesStream.on('end', () => {
        const diff = process.hrtime(startTime);
        const elapsedTime = diff[0] * 1000 + diff[1] / 1e6;
        console.log(`Request took ${elapsedTime.toFixed(2)} ms`);
      });
      linesStream.on('error', (err) => {
        console.error('Stream error:', err);
        res.destroy(err);
      });
    } catch (error) {
      next(error);
    }
  }
);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}. Searching in ${BASE_DIR}`);
});

export default app;
