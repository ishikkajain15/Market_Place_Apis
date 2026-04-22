import { Router } from 'express';
import { db } from '../db.js';

import countries from 'i18n-iso-countries';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
countries.registerLocale(require('i18n-iso-countries/langs/en.json'));


const router = Router();
const itineraries = db.collection('cruise_itineraries');
const portMasters = db.collection('port_masters');

// GET /api/itineraries/:id
router.get('/:id', async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return res.status(404).json({ error: 'Itinerary not found' });
        }

        const pipeline = [
            { $match: { id } },
            { $project: { _id: 0, id: 1, nodes: 1, portsOfCalls: 1, normalizedPortsOfCall: 1 } },
            { $unwind: '$nodes' },
            {
                $group: {
                    _id: { $ifNull: ['$nodes.dayOffSet', 0] },
                    portsOfCalls: { $first: '$portsOfCalls' },
                    normalizedPortsOfCall: { $first: '$normalizedPortsOfCall' },
                    itinId: { $first: '$id' },
                    description: { $first: '$nodes.longDescription' },
                    ports: {
                        $push: {
                            internalCode: '$nodes.port.internalCode',
                            description: '$nodes.description',
                            arrivalTime: { $ifNull: ['$nodes.arrivalTime', null] },
                            departureTime: { $ifNull: ['$nodes.departureTime', null] },
                        },
                    },
                },
            },
            { $sort: { _id: 1 } },
            {
                $group: {
                    _id: null,
                    itinId: { $first: '$itinId' },
                    portsOfCalls: { $first: '$portsOfCalls' },
                    normalizedPortsOfCall: { $first: '$normalizedPortsOfCall' },
                    maxDay: { $max: '$_id' },
                    firstDayPorts: { $first: '$ports' },
                    lastDayPorts: { $last: '$ports' },
                    days: {
                        $push: {
                            day: '$_id',
                            description: '$description',
                            ports: '$ports',
                        },
                    },
                },
            },
            {
                $project: {
                    _id: 0,
                    id: '$itinId',
                    duration: '$maxDay',
                    departure: {
                        code: { $arrayElemAt: ['$firstDayPorts.internalCode', 0] },
                        type: 'CruisePort',
                    },
                    arrival: {
                        code: { $arrayElemAt: ['$lastDayPorts.internalCode', { $subtract: [{ $size: '$lastDayPorts' }, 1] }] },
                        type: 'CruisePort',
                    },
                    portsOfCalls: 1,
                    normalizedPortsOfCall: 1,
                    totalPorts: {
                        $size: { $split: ['$normalizedPortsOfCall', '|'] },
                    },
                    days: 1,
                },
            },
        ];

        const docs = await itineraries.aggregate(pipeline, { maxTimeMS: 10_000 }).toArray();

        if (docs.length === 0) {
            return res.status(404).json({ error: 'Itinerary not found' });
        }

        const result = docs[0];

        // Collect all unique port codes from every day.
        const allCodes = new Set();
        for (const day of result.days) {
            for (const port of day.ports) {
                if (port.internalCode) allCodes.add(port.internalCode);
            }
        }

        // Bulk lookup countryId from port_masters.
        const portDocs = await portMasters
            .find(
                { code: { $in: [...allCodes] } },
                { projection: { _id: 0, code: 1, 'settings.countryId': 1 } }
            )
            .toArray();

        const countryMap = new Map(
            portDocs.map(p => [p.code, p.settings?.countryId ?? null])
        );

        // Attach countryId to each port in every day.
        for (const day of result.days) {
            for (const port of day.ports) {
                const code = countryMap.get(port.internalCode) ?? null;
                port.countryId = code;
                port.countryName = code ? countries.getName(code, 'en') ?? null : null;
            }
        }

        res.json(result);
    } catch (err) {
        next(err);
    }
});

export default router;