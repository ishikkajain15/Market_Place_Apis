import { Router } from 'express';
import countries from 'i18n-iso-countries';

// import countries from 'i18n-iso-countries';
// import { createRequire } from 'module';
// const require = createRequire(import.meta.url);
// countries.registerLocale(require('i18n-iso-countries/langs/en.json'));


import { db } from '../db.js';

const router = Router();
const destinations = db.collection('destination_masters');

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

export default router;