import { Router } from 'express';
import countries from 'i18n-iso-countries';

// import countries from 'i18n-iso-countries';
// import { createRequire } from 'module';
// const require = createRequire(import.meta.url);
// countries.registerLocale(require('i18n-iso-countries/langs/en.json'));


import { db } from '../db.js';

const router = Router();
const destinations = db.collection('destination_masters');

// At the top of the file, after imports
const portCodesCache = new Map();

// Override map for names that i18n-iso-countries doesn't resolve.
const OVERRIDES = {
  'Great Britain': 'GB',
  'South Korea': 'KR',
  // Add as discovered.
};

function nameToIsoCode(name) {
  if (!name) return null;
  const trimmed = name.trim();
  return OVERRIDES[trimmed] || countries.getAlpha2Code(trimmed, 'en') || null;
}

// GET /api/destinations
router.get('/', async (req, res, next) => {
  try {
    const allDocs = await destinations
      .find({ active: true }, { maxTimeMS: 15_000 })
      .project({ _id: 0, id: 1, name: 1, active: 1, parentId: 1 })
      .toArray();

    // Build a lookup map: id → doc (for subtree traversal).
    const byId = new Map(allDocs.map(d => [d.id, d]));

    // Pre-resolve every destination name to an ISO code (or null).
    const codeMap = new Map();
    for (const d of allDocs) {
      codeMap.set(d.id, nameToIsoCode(d.name));
    }

    // For a region, find all descendants via parentId chain and collect
    // their resolved country codes. Only goes 2–3 levels deep.
    function getDescendantCodes(parentIdStr, visited = new Set()) {
      if (visited.has(parentIdStr)) return new Set();
      visited.add(parentIdStr);

      const codes = new Set();
      for (const d of allDocs) {
        if (d.parentId === parentIdStr && String(d.id) !== parentIdStr) {
          const code = codeMap.get(d.id);
          if (code) {
            codes.add(code);
          } else {
            const subCodes = getDescendantCodes(String(d.id), visited);
            for (const sc of subCodes) codes.add(sc);
          }
        }
      }
      return codes;
    }

    const data = allDocs.map(d => {
      const isoCode = codeMap.get(d.id);
      const isSelfRef = d.parentId === String(d.id);

      let type;
      let countryCodes;

      if (isoCode) {
        // Name resolves to a country code → it's a country.
        type = 'country';
        countryCodes = [isoCode];
      } else {
        // Name doesn't resolve → it's a region.
        type = 'region';
        const codes = getDescendantCodes(String(d.id));
        countryCodes = [...codes].sort();
      }

      return {
        id: d.id,
        name: d.name,
        active: d.active,
        type,
        parentId: isSelfRef ? null : (d.parentId ? Number(d.parentId) : null),
        countryCodes,
      };
    });

    res.json({
      total: data.length,
      data,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/destinations/:id/ports
// router.get('/:id/ports', async (req, res, next) => {
//   try {
//     const id = Number(req.params.id);
//     if (!Number.isFinite(id)) {
//       return res.status(404).json({ error: 'Destination not found' });
//     }

//     const dest = await destinations.findOne(
//       { id, active: true },
//       { projection: { _id: 0, id: 1, name: 1, parentId: 1 } }
//     );

//     if (!dest) {
//       return res.status(404).json({ error: 'Destination not found' });
//     }

//     const isoCode = nameToIsoCode(dest.name);
//     let countryCodes;

//     if (isoCode) {
//       countryCodes = [isoCode];
//     } else {
//       const allDocs = await destinations
//         .find({ active: true }, { projection: { _id: 0, id: 1, name: 1, parentId: 1 } })
//         .toArray();

//       const visited = new Set();
      
//       function getDescendantCodes(parentIdStr) {
//         if (visited.has(parentIdStr)) return new Set();
//         visited.add(parentIdStr);
//         const codes = new Set();
//         for (const d of allDocs) {
//           if (d.parentId === parentIdStr && String(d.id) !== parentIdStr) {
//             const code = nameToIsoCode(d.name);
//             if (code) {
//               codes.add(code);
//             } else {
//               const subCodes = getDescendantCodes(String(d.id));
//               for (const sc of subCodes) codes.add(sc);
//             }
//           }
//         }
//         return codes;
//       }

//       countryCodes = [...getDescendantCodes(String(id))].sort();
//     }

//     const portsMasters = db.collection('port_masters');
//     const cruisesCol = db.collection('cruises');
//     let portCodes;

//     if (countryCodes.length > 0) {
//       // Path 1 — unchanged, already fast
//       const docs = await portsMasters
//         .find(
//           { active: true, 'settings.countryId': { $in: countryCodes } },
//           { projection: { _id: 0, code: 1 } }
//         )
//         .sort({ code: 1 })
//         .toArray();

//       portCodes = docs.map(d => d.code);
//     } else {
//       // Path 2 — check cache first
//       if (portCodesCache.has(id)) {
//         portCodes = portCodesCache.get(id);
//       } else {
//         const cruiseDocs = await cruisesCol
//           .find(
//             {
//               $or: [{ 'destination.id': id }, { parentDestinationIds: id }],
//               status: 'Publish',
//               isActive: true,
//             },
//             { projection: { _id: 0, 'itinerary.normalizedPortsOfCall': 1 } }
//           )
//           .toArray();

//         const codeSet = new Set();
//         for (const doc of cruiseDocs) {
//           const raw = doc.itinerary?.normalizedPortsOfCall;
//           if (raw) {
//             for (const code of raw.split('|')) {
//               const trimmed = code.trim();
//               // Skip numeric codes — they're IDs, not port codes
//               if (trimmed && !/^\d+$/.test(trimmed)) {
//                 codeSet.add(trimmed);
//               }
//             }
//           }
//         }

//         portCodes = [...codeSet].sort();
//         portCodesCache.set(id, portCodes);
//       }
//     }

//     res.json({
//       destinationId: id,
//       destinationName: dest.name,
//       countryCodes,
//       source: countryCodes.length > 0 ? 'countryCodes' : 'cruiseData',
//       total: portCodes.length,
//       portCodes,
//     });
//   } catch (err) {
//     next(err);
//   }
// });

export default router;