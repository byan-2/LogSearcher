import { Request, Response, NextFunction } from 'express';
import { FileQueryValidator, FileQuery } from '../utils/validators';

export function validateFileQuery(
  req: Request<{}, {}, {}, FileQuery>,
  res: Response,
  next: NextFunction
) {
  try {
    const validator = new FileQueryValidator();
    validator.validate(req.query);
    next();
  } catch (error) {
    // Optionally, you can check if error is instance of ValidationError
    next(error);
  }
}
