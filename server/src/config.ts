import path from 'path';

const config = {
  port: process.env.PORT || 3001,
  baseDir:
    process.env.NODE_ENV === 'test'
      ? path.join(__dirname, '..', 'test', 'logs')
      : '/var/log',
};

export default config;
