import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const cruises = db.collection('cruises');

// Shared aggregation stages: join + project the fields we care about.
function buildPipeline(matchStage) {
  return [
    { $match: matchStage },
    {
      $lookup: {
        from: 'cruise_itineraries',
        localField: 'itinerary.id',
        foreignField: 'id',
        as: 'itineraryDetails',
      },
    },
    {
      $addFields: {
        itineraryDetails: { $arrayElemAt: ['$itineraryDetails', 0] },
      },
    },
    {
      $project: {
        _id: 0,
        id: 1,
        voyageId: 1,
        name: 1,
        'ship.id': 1,
        'ship.cruiseline.id': 1,
        'ship.cruiseline.logoPath': 1,
        'ship.images': 1,
        'destination.id': 1,
        destinationImagePath: 1,
        startDateTime: 1,
        'itinerary.id': 1,
        'itinerary.departure.code': 1,
        'itinerary.arrival.code': 1,
        'itinerary.duration': 1,
        'itinerary.fallbackMapPath': 1,
        categoryTypes: 1,
        itineraryDetails: 1,
      },
    },
  ];
}

// GET /api/cruises?limit=50&skip=0
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
      cruises.aggregate(pipeline, { maxTimeMS: 15_000 }).toArray(),
      cruises.estimatedDocumentCount(),
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

// GET /api/cruises/:id
router.get('/:id', async (req, res, next) => {
  try {
    const pipeline = buildPipeline({ id: req.params.id });
    const docs = await cruises.aggregate(pipeline, { maxTimeMS: 10_000 }).toArray();

    if (docs.length === 0) {
      return res.status(404).json({ error: 'Cruise not found' });
    }
    res.json(docs[0]);
  } catch (err) {
    next(err);
  }
});

export default router;