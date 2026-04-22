import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { client } from './db.js';
import routes from './routes/index.js';
import { notFound, errorHandler } from './middleware/error.js';



const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json({ limit: '100kb' }));

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);



const server = app.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
});

async function shutdown(signal) {
  console.log(`\n[${signal}] shutting down`);
  server.close(async () => {
    await client.close();
    console.log('[shutdown] clean');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));