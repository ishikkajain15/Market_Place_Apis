import { MongoClient } from 'mongodb';
import { config } from './config.js';

const client = new MongoClient(config.mongoUri, {
  maxPoolSize: 20,
  serverSelectionTimeoutMS: 5000,
});

await client.connect();
const db = client.db(config.mongoDb);
console.log(`[db] connected to ${config.mongoDb}`);

export { client, db };