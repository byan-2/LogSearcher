import path from 'path';
import config from '../config';
import { promises as fs } from 'fs';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface Validator<T> {
  validate(input: T): void;
}

export interface FileQuery {
  filepath?: string;
  entries?: string;
  search?: string;
}

export class FilenameValidator implements Validator<string | undefined> {
  constructor(private maxDirLength: number = 4096) {}
  validate(filepath: string | undefined): void {
    if (!filepath) {
      throw new ValidationError('File path is required');
    }
    if (filepath.length === 0 || filepath.length > this.maxDirLength) {
      throw new ValidationError(
        `Invalid filename, length must be under ${this.maxDirLength} characters`
      );
    }
  }
}

export class EntriesValidator implements Validator<string | undefined> {
  constructor(private maxEntries: number = Number.MAX_SAFE_INTEGER) {}
  validate(entries: string | undefined): void {
    if (entries !== undefined) {
      const parsed = parseInt(entries, 10);
      if (isNaN(parsed) || parsed < 0 || parsed > this.maxEntries) {
        throw new ValidationError(
          'Entries must be a valid non-negative integer.'
        );
      }
    }
  }
}

export class SearchValidator implements Validator<string | undefined> {
  constructor(private maxSearchLength: number = 10000) {}
  validate(search: string | undefined): void {
    if (search !== undefined) {
      if (search.length === 0 || search.length > this.maxSearchLength) {
        throw new ValidationError(
          `Invalid search query, length must be between 1 and ${this.maxSearchLength} characters`
        );
      }

      // disallow invisible control characters, formatting codes, directional control characters, and zero width space
      if (
        !/^[^\p{C}\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]+$/u.test(
          search
        )
      ) {
        throw new ValidationError('Invalid characters in search query');
      }
    }
  }
}

export class FileQueryValidator implements Validator<FileQuery> {
  private validators: Array<Validator<any>>;

  constructor() {
    this.validators = [
      new FilenameValidator(),
      new EntriesValidator(),
      new SearchValidator(),
    ];
  }

  validate(query: FileQuery): void {
    this.validators.forEach((validator) => {
      if (validator instanceof FilenameValidator) {
        validator.validate(query.filepath);
      } else if (validator instanceof EntriesValidator) {
        validator.validate(query.entries);
      } else if (validator instanceof SearchValidator) {
        validator.validate(query.search);
      }
    });
  }
}

export async function getSecureFilePath(userInput: string): Promise<string> {
  const resolvedPath = path.join(config.baseDir, userInput.trim());
  const relative = path.relative(config.baseDir, resolvedPath);
  if (relative.startsWith('..')) {
    throw new ValidationError('Invalid file path');
  }
  try {
    const stat = await fs.stat(resolvedPath);
    if (!stat.isFile()) {
      throw new ValidationError('Not a valid file');
    }
    return resolvedPath;
  } catch (err) {
    throw new ValidationError('File not found');
  }
}
