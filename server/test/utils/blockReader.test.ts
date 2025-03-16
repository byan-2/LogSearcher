import { promises as fs } from 'fs';
import path from 'path';
import { ReverseBlockReader } from '../../src/utils/blockReader';

describe('ReverseBlockReader with real files', () => {
  const filePaths = {
    regular: path.join(__dirname, 'temp_test_file.txt'),
    singleLine: path.join(__dirname, 'temp_test_file_single_line.txt'),
    empty: path.join(__dirname, 'temp_test_file_empty.txt'),
  };
  beforeAll(async () => {
    // File content is in reverse order so that generateLines will output lines in natural order.
    // Using content that forces block splits when using a small blockSize.
    // The file content is: "line4\nline3\nline2\nline1\n"
    await fs.writeFile(
      filePaths.regular,
      'line4\nline3\nline2\nline1\n',
      'utf8'
    );
    await fs.writeFile(
      filePaths.singleLine,
      'line1line2line3line4line5',
      'utf8'
    );
    await fs.writeFile(filePaths.empty, '', 'utf8');
  });

  afterAll(async () => {
    //loop over object, unlink each file
    for (const filePath of Object.values(filePaths)) {
      await fs.unlink(filePath);
    }
  });

  it('should read blocks correctly', async () => {
    const fileHandle = await fs.open(filePaths.regular, 'r');
    const blockSize = 12;
    const reader = new ReverseBlockReader(fileHandle, undefined, undefined, {
      blockSize,
      memBuffer: 1024,
    });
    const blocks: string[] = [];
    for await (const block of reader.readBlocks()) {
      blocks.push(block);
    }
    await fileHandle.close();
    expect(blocks.join('')).toBe('line1\nline2\nline3\nline4\n');
  });

  //test queries with blocks of different sizes
  it('should read blocks correctly with different block sizes', async () => {
    const fileHandle = await fs.open(filePaths.regular, 'r');
    const reader = new ReverseBlockReader(fileHandle, 3, undefined, {
      blockSize: 3,
      memBuffer: 1024,
    });
    const blocks: string[] = [];
    for await (const block of reader.readBlocks()) {
      blocks.push(block);
    }
    await fileHandle.close();
    expect(blocks.join('')).toBe('line1\nline2\nline3\n');
  });

  it('should read blocks correctly with single line file', async () => {
    const fileHandle = await fs.open(filePaths.singleLine, 'r');
    const reader = new ReverseBlockReader(fileHandle, undefined, undefined, {
      blockSize: 12,
      memBuffer: 1024,
    });
    const blocks: string[] = [];
    for await (const block of reader.readBlocks()) {
      blocks.push(block);
    }
    await fileHandle.close();
    expect(blocks.join('')).toBe('line1line2line3line4line5\n');
  });

  it('should read blocks correctly with empty file', async () => {
    const fileHandle = await fs.open(filePaths.empty, 'r');
    const reader = new ReverseBlockReader(fileHandle, undefined, undefined, {
      blockSize: 12,
      memBuffer: 1024,
    });
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
    const reader = new ReverseBlockReader(fileHandle, undefined, undefined, {
      blockSize: 3,
      memBuffer: 1024,
    }); // Force splits
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
    const reader = new ReverseBlockReader(fileHandle, undefined, undefined, {
      blockSize: 12,
      memBuffer: 1024,
    });
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
    const reader = new ReverseBlockReader(fileHandle, undefined, undefined, {
      blockSize: 12,
      memBuffer: 1024,
    });
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
    const reader = new ReverseBlockReader(fileHandle, undefined, undefined, {
      blockSize: 12,
      memBuffer: 1024,
    });
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
    const reader = new ReverseBlockReader(fileHandle, undefined, undefined, {
      blockSize: 12,
      memBuffer: 1024,
    });
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
    const reader = new ReverseBlockReader(fileHandle, undefined, undefined, {
      blockSize: 5,
      memBuffer: 7,
    });
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
    const reader = new ReverseBlockReader(fileHandle, undefined, undefined, {
      blockSize: 5,
      memBuffer: 10,
    });
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
    const reader = new ReverseBlockReader(fileHandle);

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
    buffer.writeUInt32BE(0x0123abcd, 0);
    await fs.writeFile(testPath, buffer);

    const fileHandle = await fs.open(testPath, 'r');
    const reader = new ReverseBlockReader(fileHandle, 128);
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
    const reader = new ReverseBlockReader(fileHandle, 128);
    //expect reader to throw an error

    await fileHandle.close();
    await fs.unlink(testPath);
    expect(reader.readBlocks().next()).rejects.toThrow();
  });

  it('should throw an error on corrupted multi-byte sequences', async () => {
    const testPath = path.join(__dirname, 'corrupted_multibyte.txt');
    // This buffer simulates a partially invalid 3-byte UTF-8 sequence
    // e.g. 0xE2 0x82 is part of a valid "€" sequence but we cut it off
    const invalidBuffer = Buffer.from([0xe2, 0x82, 0x6c, 0x69, 0x6e, 0x65]);
    // The last two bytes "line" are just ASCII letters to see if
    // the partial sequence is truly invalid

    await fs.writeFile(testPath, invalidBuffer);

    const fileHandle = await fs.open(testPath, 'r');
    const reader = new ReverseBlockReader(fileHandle, 4);

    const blocks: string[] = [];
    await expect(
      (async () => {
        for await (const block of reader.readBlocks()) {
          blocks.push(block);
        }
      })()
    ).rejects.toThrow();

    await fileHandle.close();
    await fs.unlink(testPath);
  });
  it('should handle multiple huge lines exceeding leftover limit', async () => {
    const testPath = path.join(__dirname, 'huge_lines.txt');

    // Two lines, each 12 MB, parted by a newline.
    const lineA = 'A'.repeat(12 * 1024 * 1024);
    const lineB = 'B'.repeat(12 * 1024 * 1024);
    await fs.writeFile(testPath, `${lineA}\n${lineB}\n`, 'utf8');

    const fileHandle = await fs.open(testPath, 'r');

    const reader = new ReverseBlockReader(fileHandle, undefined, undefined);

    const blocks: string[] = [];
    for await (const block of reader.readBlocks()) {
      blocks.push(block);
    }

    await fileHandle.close();
    await fs.unlink(testPath);

    // We expect both lines to appear. The code will
    // handle flushes of leftover data for each line
    // because each line is bigger than leftover limit (10MB).
    const output = blocks.join('');
    expect(output).toContain(`${lineB}\n`);
    expect(output).toContain(`${lineA}\n`);
  });
  it('should handle multi-byte UTF-8 characters', async () => {
    const testPath = path.join(__dirname, 'utf8_test.txt');
    // "café" (4 letters, 5 bytes)
    await fs.writeFile(testPath, 'café\nmünchen\n', 'utf8');

    const fileHandle = await fs.open(testPath, 'r');
    const reader = new ReverseBlockReader(fileHandle, undefined, undefined, {
      blockSize: 12,
      memBuffer: 1024,
    });
    const blocks: string[] = [];

    for await (const block of reader.readBlocks()) {
      blocks.push(block);
    }

    await fileHandle.close();
    await fs.unlink(testPath);
    expect(blocks.join('')).toBe('münchen\ncafé\n');
  });
});
