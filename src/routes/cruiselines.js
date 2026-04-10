import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const cruiselines = db.collection('cruiseline_masters');

// Shared aggregation: join ships where ship_masters.parentId (string)
// equals cruiseline_masters.id (number), coerced via $toString.
function buildPipeline(matchStage) {
  return [
    { $match: matchStage },
    {
      $lookup: {
        from: 'ship_masters',
        let: { cruiselineId: { $toString: '$id' } },
        pipeline: [
          { $match: { $expr: { $eq: ['$parentId', '$$cruiselineId'] } } },
          { $project: { _id: 0, id: 1, name: 1, active: 1 } },
        ],
        as: 'ships',
      },
    },
    {
      $project: {
        _id: 0,
        id: 1,
        name: 1,
        active: 1,
        ships: 1,
      },
    },
  ];
}

// GET /api/cruiselines?limit=50&skip=0
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const skip = Math.max(Number(req.query.skip) || 0, 0);

    const pipeline = [
      ...buildPipeline({}),
      { $skip: skip },
      { $limit: limit },
    ];

    const [data, total] = await Promise.all([
      cruiselines.aggregate(pipeline, { maxTimeMS: 15_000 }).toArray(),
      cruiselines.estimatedDocumentCount(),
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

// GET /api/cruiselines/:id
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(404).json({ error: 'Cruiseline not found' });
    }

    const pipeline = buildPipeline({ id });
    const docs = await cruiselines.aggregate(pipeline, { maxTimeMS: 10_000 }).toArray();

    if (docs.length === 0) {
      return res.status(404).json({ error: 'Cruiseline not found' });
    }
    res.json(docs[0]);
  } catch (err) {
    next(err);
  }
});

export default router;