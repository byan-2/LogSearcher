// test/api.test.ts
import request from 'supertest';
import app from '../src/app';

describe('GET /file - Query Parameters Validation', () => {
  it('should return an error when filepath is missing', async () => {
    const response = await request(app).get('/file');
    expect(response.status).toBe(400);
  });
  it('should return an error when multiple parameters are invalid', async () => {
    const response = await request(app)
      .get('/file')
      .query({ filepath: '', entries: 'NaN' });
    expect(response.status).toBe(400);
  });
  it('should return an error for negative entries', async () => {
    // Adjust this test if negative entries are not permitted
    const response = await request(app)
      .get('/file')
      .query({ filepath: 'file-basic.log', entries: '-5' });
    expect(response.status).toBe(400);
  });
  it('should ignore extra, unexpected parameters', async () => {
    const response = await request(app)
      .get('/file')
      .query({ filepath: 'file-basic.log', extraParam: 'ignore-me' });
    expect(response.status).toBe(200);
  });
  it('should return an error when entries is not a valid integer', async () => {
    const response = await request(app)
      .get('/file')
      .query({ filepath: 'file-basic.log', entries: 'abc' });

    expect(response.status).toBe(400);
  });
  it('should succeed with valid query parameters', async () => {
    const response = await request(app)
      .get('/file')
      .query({ filepath: 'file-basic.log', entries: '10', search: 'test' });

    expect(response.status).toBe(200);
  });
  it('should return an error for directory traversal attempt', async () => {
    const response = await request(app)
      .get('/file')
      .query({ filepath: '../etc/passwd' });
    expect(response.status).toBe(400);
  });
  it('should return an error when search exceeds maximum length', async () => {
    const longSearch = 'a'.repeat(10001); // one character more than allowed
    const response = await request(app)
      .get('/file')
      .query({ filepath: 'file-basic.log', search: longSearch });
    expect(response.status).toBe(400);
  });
  it('should return an error when file does not exist', async () => {
    const response = await request(app)
      .get('/file')
      .query({ filepath: 'nonexistentfile.log' });
    expect(response.status).toBe(400);
  });
  it('should return an error for an empty filePath', async () => {
    const response = await request(app).get('/file').query({ filePath: '' });
    expect(response.status).toBe(400);
  });
});

describe('GET / Directory Traversal Cases', () => {
  it('should return an error when the path escapes BASE_DIR using redundant segments', async () => {
    const response = await request(app)
      .get('/file')
      .query({ filepath: 'small/../../file-basic.log' });
    expect(response.status).toBe(400);
  });
  it('should return an error for filePath with a trailing slash "file-basic.log/"', async () => {
    const response = await request(app)
      .get('/file')
      .query({ filePath: 'file-basic.log/' });
    expect(response.status).toBe(400);
  });
  it('should return an error for dot segments traversing upward', async () => {
    const response = await request(app)
      .get('/file')
      .query({ filepath: './../file-basic.log' });
    expect(response.status).toBe(400);
  });
  it('should return an error for double-encoded directory traversal attempts', async () => {
    const response = await request(app)
      .get('/file')
      .query({ filepath: '%252e%252e/file-basic.log' });
    expect(response.status).toBe(400);
  });
  it('should succeed with a valid path containing redundant slashes', async () => {
    const response = await request(app)
      .get('/file')
      .query({ filepath: '///file-basic.log' });
    expect(response.status).toBe(200);
  });
  it('should succeed with a valid path containing a "./" prefix', async () => {
    const response = await request(app)
      .get('/file')
      .query({ filepath: './file-basic.log' });
    expect(response.status).toBe(200);
  });
  it('should return an error for encoded directory traversal attempt', async () => {
    const response = await request(app)
      .get('/file')
      .query({ filepath: '%2e%2e/file-basic.log' });
    expect(response.status).toBe(400);
  });
  it('should return an error for "." as filePath', async () => {
    const response = await request(app).get('/file').query({ filePath: '.' });
    expect(response.status).toBe(400);
  });
  it('should succeed when using safe relative traversal "small/../file-basic.log"', async () => {
    const response = await request(app)
      .get('/file')
      .query({ filepath: 'small/../file-basic.log' });
    expect(response.status).toBe(200);
  });
  it('should succeed with redundant dot segments "subdir/././file-basic.log"', async () => {
    const response = await request(app)
      .get('/file')
      .query({ filepath: 'small/././file-small-basic.log' });
    expect(response.status).toBe(200);
  });
  it('should return an error when filePath points to a directory', async () => {
    // Assuming "small" is a directory in BASE_DIR.
    const response = await request(app)
      .get('/file')
      .query({ filepath: 'small' });
    expect(response.status).toBe(400);
  });
  it('should succeed with multiple adjacent slashes', async () => {
    const response = await request(app)
      .get('/file')
      .query({ filepath: 'small////file-small-basic.log' });
    expect(response.status).toBe(200);
  });
  it('should succeed with a valid filePath that contains spaces', async () => {
    const response = await request(app)
      .get('/file')
      .query({ filepath: 'empty file.txt' });
    expect(response.status).toBe(200);
  });
  it('should succeed with a Unicode filePath "测试.txt"', async () => {
    const response = await request(app)
      .get('/file')
      .query({ filepath: '测试.txt' });
    expect(response.status).toBe(200);
  });
  it('should return an error for a path that resolves to the base directory itself', async () => {
    const response = await request(app)
      .get('/file')
      .query({ filepath: 'subdir/..' });
    expect(response.status).toBe(400);
  });
  it('should trim trailing whitespace and succeed with a valid filePath', async () => {
    const response = await request(app)
      .get('/file')
      .query({ filepath: 'file-basic.log   ' });
    expect(response.status).toBe(200);
  });
});

describe('GET /file', () => {
  it('should return 200 status with valid filepath', async () => {
    const testFilepath = 'file-basic.log';
    const response = await request(app)
      .get('/file')
      .query({ filepath: testFilepath });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
  });

  it('should return 500 status with binary file', async () => {
    const testFilepath = 'binary_file.bin';
    const response = await request(app)
      .get('/file')
      .query({ filepath: testFilepath });
    expect(response.status).toBe(500);
  });
  it('should reject null bytes in filepath', async () => {
    const response = await request(app)
      .get('/file')
      .query({ filepath: 'file\u0000.log' });
    expect(response.status).toBe(400);
  });
});
