import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const cruiselines = db.collection('cruiseline_masters');

// Shared aggregation:
//   1. Join ships from ship_masters (source of truth for which ships exist).
//      ship_masters.parentId (string) == cruiseline_masters.id (number),
//      coerced via $toString.
//   2. Join the cruises collection to scrape ship images and the cruiseline
//      logoPath — these don't exist in the master collections, only embedded
//      in cruise documents. Deduped per ship via $group + $first (best effort:
//      if a ship appears on multiple sailings with different images, the first
//      one Mongo returns wins).
//   3. Merge the scraped images into the ships array and surface logoPath
//      to the top level.
function buildPipeline(matchStage) {
  return [
    { $match: matchStage },

    // Step 1: ships from ship_masters
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

    // Step 2: pull ship images + cruiseline logoPath from cruises
    {
      $lookup: {
        from: 'cruises',
        let: { cruiselineId: '$id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$ship.cruiseline.id', '$$cruiselineId'] } } },
          {
            $group: {
              _id: '$ship.id',
              images: { $first: '$ship.images' },
              logoPath: { $first: '$ship.cruiseline.logoPath' },
            },
          },
          {
            $project: {
              _id: 0,
              shipId: '$_id',
              images: 1,
              logoPath: 1,
            },
          },
        ],
        as: 'shipContent',
      },
    },

    // Step 3: merge images into each ship, surface logoPath
    {
      $addFields: {
        ships: {
          $map: {
            input: '$ships',
            as: 'ship',
            in: {
              $mergeObjects: [
                '$$ship',
                {
                  images: {
                    $let: {
                      vars: {
                        match: {
                          $arrayElemAt: [
                            {
                              $filter: {
                                input: '$shipContent',
                                as: 'sc',
                                cond: { $eq: ['$$sc.shipId', '$$ship.id'] },
                              },
                            },
                            0,
                          ],
                        },
                      },
                      in: { $ifNull: ['$$match.images', []] },
                    },
                  },
                },
              ],
            },
          },
        },
        logoPath: { $arrayElemAt: ['$shipContent.logoPath', 0] },
      },
    },

    // Step 4: final shape
    {
      $project: {
        _id: 0,
        id: 1,
        name: 1,
        active: 1,
        logoPath: 1,
        ships: 1,
      },
    },
  ];
}

// GET /api/cruiselines?limit=50&skip=0
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
      cruiselines.aggregate(pipeline, { maxTimeMS: 15_000000 }).toArray(),
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