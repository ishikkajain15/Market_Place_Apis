import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const destinations = db.collection('destination_masters');

const projection = { _id: 0, id: 1, name: 1, active: 1 };

// GET /api/destinations?limit=50&skip=0
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const skip = Math.max(Number(req.query.skip) || 0, 0);

    const [data, total] = await Promise.all([
      destinations
        .find({}, { projection, maxTimeMS: 15_000 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      destinations.estimatedDocumentCount(),
    ]);

    res.json({
      total,
      count: data.length,
      limit,
      skip,
      data,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/destinations/:id
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(404).json({ error: 'Destination not found' });
    }

    const doc = await destinations.findOne({ id }, { projection, maxTimeMS: 10_000 });
    if (!doc) {
      return res.status(404).json({ error: 'Destination not found' });
    }
    res.json(doc);
  } catch (err) {
    next(err);
  }
});

export default router;