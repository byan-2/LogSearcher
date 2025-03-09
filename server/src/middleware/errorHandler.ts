import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../utils/validators';

export default (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (error instanceof ValidationError) {
    res.status(400).send({ message: error.message });
    return;
  }
  console.error(error);
  res.status(500).send({ message: error.message });
};
