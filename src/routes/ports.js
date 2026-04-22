import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const ports = db.collection('port_masters');

const projection = {
  _id: 0,
  code: 1,
  name: 1,
  active: 1,
  latitude: '$settings.lattitude',
  longitude: '$settings.longitude',
  countryId: '$settings.countryId',
};

// GET /api/ports (bulk — active only, sorted by code)
router.get('/', async (req, res, next) => {
  try {
    const data = await ports
      .aggregate(
        [
          { $match: { active: true } },
          { $sort: { code: 1 } },
          { $project: projection },
        ],
        { maxTimeMS: 15_000 }
      )
      .toArray();

    res.json({
      total: data.length,
      data,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/ports/:code
router.get('/:code', async (req, res, next) => {
  try {
    const code = req.params.code.toUpperCase();

    const docs = await ports
      .aggregate(
        [
          { $match: { code, active: true } },
          { $project: projection },
        ],
        { maxTimeMS: 5_000 }
      )
      .toArray();

    if (docs.length === 0) {
      return res.status(404).json({ error: 'Port not found' });
    }
    res.json(docs[0]);
  } catch (err) {
    next(err);
  }
});

export default router;