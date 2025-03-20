import express from 'express';
import { Request, Response, NextFunction } from 'express';
import { Readable } from 'stream';
import { validateFileQuery } from './middleware/validateFileQuery';
import { FileQuery, getSecureFilePath } from './utils/validators';
import { generateLines } from './utils/blockReader';
import config from './config';
import errorHandler from './middleware/errorHandler';
import { corsMiddleware } from './middleware/cors';

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(corsMiddleware);

app.get(
  '/file',
  validateFileQuery,
  async (
    req: Request<{}, {}, {}, FileQuery>,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { filepath, entries, search } = req.query;
      const numEntries =
        entries !== undefined ? parseInt(entries, 10) : Infinity;
      const secureFilePath = await getSecureFilePath(filepath as string);
      const linesIterator = generateLines(secureFilePath, numEntries, search);
      const linesStream = Readable.from(linesIterator);
      res.set({ 'content-type': 'text/plain; charset=utf-8' });
      // terminate stream when client closes connection
      req.on('close', () => {
        linesIterator.return(undefined);
      });
      linesStream.pipe(res);
      linesStream.on('error', (err) => {
        if (!res.headersSent) {
          res.status(500).send(err.message ?? 'Internal server error');
        } else {
          res.destroy(err);
        }
      });
    } catch (error) {
      next(error);
    }
  }
);
app.use(errorHandler);

if (process.env.NODE_ENV !== 'test') {
  app.listen(config.port, () => {
    console.log(
      `Server is running on port ${config.port}. Searching in ${config.baseDir}`
    );
  });
}

export default app;
