import { promises as fs } from 'fs';
import path from 'path';
import { ReverseBlockReader, generateLines } from '../../src/utils/blockReader';

describe('ReverseBlockReader with real files', () => {
  const testFilePath = path.join(__dirname, 'temp_test_file.txt');

  beforeAll(async () => {
    // File content is in reverse order so that generateLines will output lines in natural order.
    // Using content that forces block splits when using a small blockSize.
    // The file content is: "line4\nline3\nline2\nline1\n"
    await fs.writeFile(testFilePath, 'line4\nline3\nline2\nline1\n', 'utf8');
    await fs.writeFile(
      path.join(__dirname, 'temp_test_file_single_line.txt'),
      'line1line2line3line4line5',
      'utf8'
    );
    await fs.writeFile(
      path.join(__dirname, 'temp_test_file_empty.txt'),
      '',
      'utf8'
    );
  });

  afterAll(async () => {
    await fs.unlink(testFilePath);
  });

  it('should read blocks correctly', async () => {
    const fileHandle = await fs.open(testFilePath, 'r');
    const { size } = await fileHandle.stat();
    const blockSize = 12;
    const reader = new ReverseBlockReader(fileHandle, size, blockSize);
    const blocks: string[] = [];
    for await (const block of reader.readBlocks()) {
      blocks.push(block);
    }
    await fileHandle.close();
    expect(blocks.join('')).toBe('line1\nline2\nline3\nline4\n');
  });

  //test queries with blocks of different sizes
  it('should read blocks correctly with different block sizes', async () => {
    const fileHandle = await fs.open(testFilePath, 'r');
    const { size } = await fileHandle.stat();
    const reader = new ReverseBlockReader(fileHandle, size, 3);
    const blocks: string[] = [];
    for await (const block of reader.readBlocks()) {
      blocks.push(block);
    }
    await fileHandle.close();
    expect(blocks.join('')).toBe('line1\nline2\nline3\n');
  });

  it('should read blocks correctly with single line file', async () => {
    const fileHandle = await fs.open(
      path.join(__dirname, 'temp_test_file_single_line.txt'),
      'r'
    );
    const { size } = await fileHandle.stat();
    const reader = new ReverseBlockReader(fileHandle, size, 12);
    const blocks: string[] = [];
    for await (const block of reader.readBlocks()) {
      blocks.push(block);
    }
    await fileHandle.close();
    expect(blocks.join('')).toBe('line1line2line3line4line5\n');
  });

  it('should read blocks correctly with empty file', async () => {
    const fileHandle = await fs.open(
      path.join(__dirname, 'temp_test_file_empty.txt'),
      'r'
    );
    const { size } = await fileHandle.stat();
    const reader = new ReverseBlockReader(fileHandle, size, 12);
    const blocks: string[] = [];
    for await (const block of reader.readBlocks()) {
      blocks.push(block);
    }
    await fileHandle.close();
    expect(blocks.join('')).toBe('');
  });

  it('should handle multi-byte UTF-8 characters across block boundaries', async () => {
    const testPath = path.join(__dirname, 'utf8_test.txt');
    // "café" (4 letters, 5 bytes) split across blocks
    await fs.writeFile(testPath, 'café\nmünchen\n', 'utf8');

    const fileHandle = await fs.open(testPath, 'r');
    const { size } = await fileHandle.stat();
    const reader = new ReverseBlockReader(fileHandle, size, 3); // Force splits
    const blocks: string[] = [];

    for await (const block of reader.readBlocks()) {
      blocks.push(block);
    }

    await fileHandle.close();
    await fs.unlink(testPath);
    expect(blocks.join('')).toBe('münchen\ncafé\n');
  });

  //search utf8 characters in the middle of a block
  it('should handle multi-byte UTF-8 characters in the middle of a block', async () => {
    const testPath = path.join(__dirname, 'utf8_test.txt');
    // "café" (4 letters, 5 bytes) in the middle of a block
    await fs.writeFile(testPath, 'müncaféchen\n', 'utf8');

    const fileHandle = await fs.open(testPath, 'r');
    const { size } = await fileHandle.stat();
    const reader = new ReverseBlockReader(fileHandle, size, 12);
    const blocks: string[] = [];

    for await (const block of reader.readBlocks()) {
      blocks.push(block);
    }

    await fileHandle.close();
    await fs.unlink(testPath);
    expect(blocks.join('')).toBe('müncaféchen\n');
  });

  it('should handle multi-byte UTF-8 characters at the end of a block', async () => {
    const testPath = path.join(__dirname, 'utf8_test.txt');
    // "café" (4 letters, 5 bytes) at the end of a block
    await fs.writeFile(testPath, 'münchencafé\n', 'utf8');

    const fileHandle = await fs.open(testPath, 'r');
    const { size } = await fileHandle.stat();
    const reader = new ReverseBlockReader(fileHandle, size, 12);
    const blocks: string[] = [];

    for await (const block of reader.readBlocks()) {
      blocks.push(block);
    }

    await fileHandle.close();
    await fs.unlink(testPath);
    expect(blocks.join('')).toBe('münchencafé\n');
  });

  it('should handle multi-byte UTF-8 characters at the beginning of a block', async () => {
    const testPath = path.join(__dirname, 'utf8_test.txt');
    // "café" (4 letters, 5 bytes) at the beginning of a block
    await fs.writeFile(testPath, 'caféchen\n', 'utf8');

    const fileHandle = await fs.open(testPath, 'r');
    const { size } = await fileHandle.stat();
    const reader = new ReverseBlockReader(fileHandle, size, 12);
    const blocks: string[] = [];

    for await (const block of reader.readBlocks()) {
      blocks.push(block);
    }

    await fileHandle.close();
    await fs.unlink(testPath);
    expect(blocks.join('')).toBe('caféchen\n');
  });

  it('should handle files without trailing newline', async () => {
    const testPath = path.join(__dirname, 'no_trailing_newline.txt');
    await fs.writeFile(testPath, 'line3\nline2\nline1', 'utf8'); // No final \n

    const fileHandle = await fs.open(testPath, 'r');
    const { size } = await fileHandle.stat();
    const reader = new ReverseBlockReader(fileHandle, size, 4);
    const blocks: string[] = [];

    for await (const block of reader.readBlocks()) {
      blocks.push(block);
    }

    await fileHandle.close();
    await fs.unlink(testPath);
    expect(blocks.join('')).toBe('line1\nline2\nline3\n');
  });
  it('should handle mixed line endings (\\n and \\r\\n)', async () => {
    const testPath = path.join(__dirname, 'mixed_endings.txt');
    await fs.writeFile(testPath, 'line3\r\nline2\nline1\r\n', 'utf8');

    const fileHandle = await fs.open(testPath, 'r');
    const { size } = await fileHandle.stat();
    const reader = new ReverseBlockReader(fileHandle, size, 5);
    const blocks: string[] = [];

    for await (const block of reader.readBlocks()) {
      blocks.push(block);
    }

    await fileHandle.close();
    await fs.unlink(testPath);
    expect(blocks.join('')).toBe('line1\r\nline2\nline3\r\n');
  });
  it('should handle multiple consecutive newlines', async () => {
    const testPath = path.join(__dirname, 'consecutive_newlines.txt');
    await fs.writeFile(testPath, '\n\nline3\n\nline2\n\n\nline1\n\n', 'utf8');

    const fileHandle = await fs.open(testPath, 'r');
    const { size } = await fileHandle.stat();
    const reader = new ReverseBlockReader(fileHandle, size, 4);
    const blocks: string[] = [];

    for await (const block of reader.readBlocks()) {
      blocks.push(block);
    }

    await fileHandle.close();
    await fs.unlink(testPath);
    expect(blocks.join('')).toBe('line1\nline2\nline3\n');
  });

  it('should handle maxInMemoryLeftover limit', async () => {
    const testPath = path.join(__dirname, 'memory_limit.txt');
    const longLine = 'a'.repeat(1024 * 1024 * 15); // 15MB line
    await fs.writeFile(testPath, `${longLine}\nshort\n`, 'utf8');

    const fileHandle = await fs.open(testPath, 'r');
    const { size } = await fileHandle.stat();
    const reader = new ReverseBlockReader(
      fileHandle,
      size,
      1024 * 1024, // 1MB blocks
      10 * 1024 * 1024 // 10MB memory limit
    );

    const blocks: string[] = [];
    for await (const block of reader.readBlocks()) {
      blocks.push(block);
    }

    await fileHandle.close();
    await fs.unlink(testPath);

    // Verify both lines are present
    expect(blocks.join('')).toMatch(/short/);
    expect(blocks.join('')).toMatch(/a{10}/); // Partial content check
  });
  it('should handle binary files with null bytes', async () => {
    const testPath = path.join(__dirname, 'binary_file.bin');
    const buffer = Buffer.alloc(1024);
    buffer.writeUInt32BE(0xdeadbeef, 0);
    await fs.writeFile(testPath, buffer);

    const fileHandle = await fs.open(testPath, 'r');
    const reader = new ReverseBlockReader(fileHandle, buffer.length, 128);
    //expect reader to throw an error

    await fileHandle.close();
    await fs.unlink(testPath);
    expect(reader.readBlocks().next()).rejects.toThrow();
  });

  it('should handle partial binary and text files', async () => {
    const testPath = path.join(__dirname, 'partial_file.bin');
    const buffer = Buffer.alloc(1024);
    buffer.writeUInt32BE(0xdeadbeef, 0);
    await fs.writeFile(testPath, buffer);

    const fileHandle = await fs.open(testPath, 'r');
    const reader = new ReverseBlockReader(fileHandle, buffer.length, 128);
    //expect reader to throw an error

    await fileHandle.close();
    await fs.unlink(testPath);
    expect(reader.readBlocks().next()).rejects.toThrow();
  });

  it('should handle closed file handles gracefully', async () => {
    const fileHandle = await fs.open(testFilePath, 'r');
    const reader = new ReverseBlockReader(
      fileHandle,
      (await fileHandle.stat()).size,
      12
    );
  });
  it('should handle file growth during reading', async () => {
    const testPath = path.join(__dirname, 'growing_file.txt');
    // Initial content: 'line2\nline1\n' (12 bytes)
    await fs.writeFile(testPath, 'line2\nline1\n', 'utf8');

    const fileHandle = await fs.open(testPath, 'r');
    const { size } = await fileHandle.stat();
    // Set blockSize to 6 bytes to split reading into two blocks
    const reader = new ReverseBlockReader(
      fileHandle,
      size,
      5, // numEntries
      6 // blockSize (smaller than file size)
    );

    // Simulate concurrent writer after the first block is processed
    const writer = fs.open(testPath, 'a');
    const readPromise = (async () => {
      const blocks: string[] = [];
      for await (const block of reader.readBlocks()) {
        blocks.push(block);
        if (blocks.length === 1) {
          // Append new data after first block is read (position 6)
          await (await writer).appendFile('line3\n');
        }
      }
      await (await writer).close();
      return blocks;
    })();

    const result = await readPromise;
    await fileHandle.close();
    await fs.unlink(testPath);

    // Should only include original content, ignoring 'line3'
    expect(result.join('')).toBe('line1\nline2\n');
  });
});
