import { Router } from 'express';
import { db } from '../db.js';
import cruisesRouter from './cruises.js';
import cruiselinesRouter from './cruiselines.js';
import destinationsRouter from './destinations.js';

const router = Router();

router.get('/health', async (req, res, next) => {
  try {
    await db.command({ ping: 1 });
    res.json({ status: 'ok', db: 'up' });
  } catch (err) {
    next(err);
  }
});

router.use('/cruises', cruisesRouter);
router.use('/cruiselines', cruiselinesRouter);
router.use('/destinations', destinationsRouter);

export default router;  