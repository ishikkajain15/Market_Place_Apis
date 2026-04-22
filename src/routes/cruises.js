import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const cruises = db.collection('cruises');

const BASE_MATCH = { status: 'Publish', isActive: true, cruiseType: 'CruiseOnly' };

function buildPipeline(matchStage) {
  return [
    { $match: { ...BASE_MATCH, ...matchStage } },

    // Lookup cruise_itineraries — only to build the lightweight days array.
    {
      $lookup: {
        from: 'cruise_itineraries',
        let: { itinId: '$itinerary.id', startDate: '$startDateTime' },
        pipeline: [
          { $match: { $expr: { $eq: ['$id', '$$itinId'] } } },
          { $project: { _id: 0, nodes: 1 } },
          { $unwind: '$nodes' },

          // Group by dayOffSet, collect only internalCode per port.
          {
            $group: {
              _id: { $ifNull: ['$nodes.dayOffSet', 0] },
              portCodes: { $push: '$nodes.port.internalCode' },
            },
          },
          { $sort: { _id: 1 } },

          // Re-group into single doc with days array; compute dates.
          {
            $group: {
              _id: null,
              days: {
                $push: {
                  day: '$_id',
                  date: {
                    $dateToString: {
                      format: '%d-%b-%Y',
                      date: {
                        $dateAdd: {
                          startDate: {
                            $dateFromString: {
                              dateString: '$$startDate',
                              format: '%d-%b-%Y',
                            },
                          },
                          unit: 'day',
                          amount: '$_id',
                        },
                      },
                    },
                  },
                  portCodes: '$portCodes',
                },
              },
            },
          },
          { $project: { _id: 0 } },
        ],
        as: '_itin',
      },
    },

    {
      $addFields: {
        _itin: { $arrayElemAt: ['$_itin', 0] },
      },
    },

    // Final shape — flat, renamed fields, no nested ship/cruiseline objects.
    {
      $project: {
        _id: 0,
        id: 1,
        voyageId: 1,
        name: 1,
        cruiseType: 1,
        startDate: '$startDateTime',
        endDate: '$endDateTime',
        duration: { $ifNull: ['$itinerary.duration', '$cruiseDuration'] },
        shipId: '$ship.id',
        cruiselineId: '$ship.cruiseline.id',
        destinationId: '$destination.id',
        itineraryId: '$itinerary.id',
        categoryTypes: 1,
        departure: {
          code: '$itinerary.departure.code',
          type: '$itinerary.departure.type',
        },
        arrival: {
          code: '$itinerary.arrival.code',
          type: '$itinerary.arrival.type',
        },
        destinationImagePath: 1,
        days: { $ifNull: ['$_itin.days', []] },
      },
    },
  ];
}

// GET /api/cruises?limit=500&skip=0
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 500, 500);
    const skip = Math.max(Number(req.query.skip) || 0, 0);

    const pipeline = [
      ...buildPipeline({}),
      { $skip: skip },
      { $limit: limit },
    ];

    const [data, total] = await Promise.all([
      cruises.aggregate(pipeline, { maxTimeMS: 30_000 }).toArray(),
      cruises.countDocuments(BASE_MATCH),
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
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(404).json({ error: 'Cruise not found' });
    }

    const pipeline = buildPipeline({ id });
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