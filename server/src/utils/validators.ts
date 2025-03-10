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
  validate(filepath: string | undefined): void {
    if (!filepath) {
      throw new ValidationError('Filepath is required');
    }
  }
}

export class EntriesValidator implements Validator<string | undefined> {
  validate(entries: string | undefined): void {
    if (entries !== undefined) {
      const parsed = parseInt(entries, 10);
      if (isNaN(parsed) || parsed < 0 || parsed > Number.MAX_SAFE_INTEGER) {
        throw new ValidationError(
          'Entries must be a valid non-negative integer.'
        );
      }
    }
  }
}

export class SearchValidator implements Validator<string | undefined> {
  private maxSearchLength: number;
  constructor(maxSearchLength: number = 10000) {
    this.maxSearchLength = maxSearchLength;
  }
  validate(search: string | undefined): void {
    if (search !== undefined) {
      if (search.length === 0 || search.length > this.maxSearchLength) {
        throw new ValidationError(
          `Invalid search query, length must be between 1 and ${this.maxSearchLength} characters`
        );
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
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
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
