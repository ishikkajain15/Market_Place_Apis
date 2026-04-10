import 'dotenv/config';

const required = ['MONGODB_URI', 'MONGODB_DB'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGODB_URI,
  mongoDb: process.env.MONGODB_DB,
  nodeEnv: process.env.NODE_ENV || 'development',
};