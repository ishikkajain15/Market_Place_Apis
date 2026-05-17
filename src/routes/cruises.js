import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const cruises = db.collection('cruises');

const BASE_MATCH = { status: 'Publish', isActive: true, cruiseType: 'CruiseOnly' };

// ---------------------------------------------------------------------------
// One-time setup: backfill real Date fields + create index.
// Runs once at module load. Safe to re-run — only updates docs missing the
// fields, and createIndex is idempotent.
// ---------------------------------------------------------------------------
async function ensureIndexesAndBackfill() {
  try {
    const result = await cruises.updateMany(
      {
        $or: [
          { startDate: { $exists: false } },
          { endDate: { $exists: false } },
        ],
      },
      [
        {
          $set: {
            startDate: {
              $dateFromString: {
                dateString: '$startDateTime',
                format: '%d-%b-%Y',
                onError: null,
                onNull: null,
              },
            },
            endDate: {
              $dateFromString: {
                dateString: '$endDateTime',
                format: '%d-%b-%Y',
                onError: null,
                onNull: null,
              },
            },
          },
        },
      ],
    );
    if (result.modifiedCount > 0) {
      console.log(`[cruises] backfilled startDate/endDate on ${result.modifiedCount} docs`);
    }

    await cruises.createIndex(
      { status: 1, isActive: 1, cruiseType: 1, startDate: 1 },
      { name: 'base_match_startDate' },
    );

    console.log('[cruises] indexes ensured');
  } catch (err) {
    console.error('[cruises] index/backfill setup failed:', err);
  }
}

ensureIndexesAndBackfill();

// ---------------------------------------------------------------------------

function buildPipeline(matchStage) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  return [
    {
      $match: {
        ...BASE_MATCH,
        ...matchStage,
        startDate: { $gte: today },
      },
    },
    { $sort: { startDate: 1 } },
    {
      $project: {
        _id: 0,
        id: 1,
        voyageId: 1,
        name: 1,
        cruiseType: 1,
        startDate: { $dateToString: { format: '%Y-%m-%d', date: '$startDate' } },
        endDate: { $dateToString: { format: '%Y-%m-%d', date: '$endDate' } },
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
      },
    },
  ];
}

// GET /api/cruises
router.get('/', async (req, res, next) => {
  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const pipeline = buildPipeline({});

    const skip  = Math.max(0, parseInt(req.query.skip,  10) || 0);
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 2000);

    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limit });

    const [data, total] = await Promise.all([
      cruises.aggregate(pipeline, { maxTimeMS: 60_000, allowDiskUse: true }).toArray(),
      cruises.countDocuments({ ...BASE_MATCH, startDate: { $gte: today } }),
    ]);

    res.json({
      total,
      skip,
      limit,
      count: data.length,
      data,
    });
  } catch (err) {
    next(err);
  }
});

export default router;