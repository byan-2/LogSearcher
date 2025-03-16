import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../utils/validators';

export default (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (res.headersSent) {
    return next(err);
  }
  const message = err.message ?? 'Internal server error';
  if (err instanceof ValidationError) {
    res.status(400).send({ message });
    return;
  }
  res.status(500).send({ message });
};
