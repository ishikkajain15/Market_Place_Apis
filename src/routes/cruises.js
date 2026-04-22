import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const cruises = db.collection('cruises');

// Shared aggregation:
//   - Lookup cruise_itineraries on itinerary.id == cruise_itineraries.id.
//   - Inside the lookup, unwind nodes, group them by dayOffSet (falling
//     back to 0 for nodes that lack one), then re-group into a single
//     itinerary document holding { portsOfCalls, normalizedPortsOfCall, days }.
//   - Each `day` carries a computed calendar date = startDateTime + dayOffSet.
//   - Project a trimmed response: ship collapses to { id }; all rich
//     ship/cruiseline info is served by the cruiselines endpoint.
function buildPipeline(matchStage) {
  return [
    { $match: {...matchStage, cruiseType: "CruiseOnly"} },

    {
      $lookup: {
        from: 'cruise_itineraries',
        let: { itinId: '$itinerary.id', startDate: '$startDateTime' },
        pipeline: [
          { $match: { $expr: { $eq: ['$id', '$$itinId'] } } },
          {
            $project: {
              _id: 0,
              id: 1,
              portsOfCalls: 1,
              normalizedPortsOfCall: 1,
              nodes: 1,
            },
          },
          { $unwind: '$nodes' },

          // Group by day, flatten each node into a clean port object.
          {
            $group: {
              _id: { $ifNull: ['$nodes.dayOffSet', 0] },
              portsOfCalls: { $first: '$portsOfCalls' },
              normalizedPortsOfCall: { $first: '$normalizedPortsOfCall' },
              ports: {
                $push: {
                  code: '$nodes.port.code',
                  type: '$nodes.port.type',
                  internalCode: '$nodes.port.internalCode',
                  description: '$nodes.description',
                  longDescription: '$nodes.longDescription',
                  arrivalTime: '$nodes.arrivalTime',
                  departureTime: '$nodes.departureTime',
                },
              },
            },
          },
          { $sort: { _id: 1 } },

          // Re-group into one doc with a `days` array; compute each day's date.
          {
            $group: {
              _id: null,
              portsOfCalls: { $first: '$portsOfCalls' },
              normalizedPortsOfCall: { $first: '$normalizedPortsOfCall' },
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
                  ports: '$ports',
                },
              },
            },
          },
          { $project: { _id: 0 } },
        ],
        as: 'itineraryDetails',
      },
    },

    // $lookup always returns an array; unwrap to a single object (or null).
    {
      $addFields: {
        itineraryDetails: { $arrayElemAt: ['$itineraryDetails', 0] },
      },
    },

    // Final shape.
    {
      $project: {
        _id: 0,
        id: 1,
        voyageId: 1,
        name: 1,
        startDateTime: 1,
        endDateTime: 1,
        departureDateTime: 1,
        categoryTypes: 1,
        destinationImagePath: 1,
        cruiseDuration: 1,
        cruiseType:1,
        'ship.id': 1,
        'destination.id': 1,
        itinerary: {
          id: '$itinerary.id',
          duration: '$itinerary.duration',
          departure: {
            code: '$itinerary.departure.code',
            type: '$itinerary.departure.type',
          },
          arrival: {
            code: '$itinerary.arrival.code',
            type: '$itinerary.arrival.type',
          },
          portsOfCalls: '$itineraryDetails.portsOfCalls',
          normalizedPortsOfCall: '$itineraryDetails.normalizedPortsOfCall',
          days: '$itineraryDetails.days',
        },
      },
    },
  ];
}

// GET /api/cruises?limit=50&skip=0
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
      cruises.aggregate(pipeline, { maxTimeMS: 15_000000 }).toArray(),
      cruises.countDocuments({ cruiseType: 'CruiseOnly' }),
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