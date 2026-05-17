import { Router } from 'express';
import countries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json' with { type: 'json' };

import { db } from '../db.js';

// i18n-iso-countries needs a locale registered before getAlpha2Code works.
countries.registerLocale(enLocale);


const router = Router();
const destinations = db.collection('destination_masters');

// Override map for names that i18n-iso-countries doesn't resolve.
const OVERRIDES = {
  'Great Britain': 'GB',
  'South Korea': 'KR',
  // Add as discovered.
};

// --- ISO-code resolution (permanent cache: name → code never changes) ---
const isoCodeCache = new Map();

function nameToIsoCode(name) {
  if (!name) return null;
  const trimmed = name.trim();
  if (isoCodeCache.has(trimmed)) {
    return isoCodeCache.get(trimmed);
  }
  const code = OVERRIDES[trimmed] || countries.getAlpha2Code(trimmed, 'en') || null;
  isoCodeCache.set(trimmed, code);
  return code;
}

// --- Build the shaped destination list from raw docs ---
function buildData(allDocs) {
  // Pre-resolve every destination name to an ISO code (or null).
  const codeMap = new Map();
  for (const d of allDocs) {
    codeMap.set(d.id, nameToIsoCode(d.name));
  }

  // Index children by parentId so traversal is a lookup, not a full scan.
  const byParent = new Map();
  for (const d of allDocs) {
    if (!byParent.has(d.parentId)) byParent.set(d.parentId, []);
    byParent.get(d.parentId).push(d);
  }

  // For a region, walk its descendants and collect resolved country codes.
  function getDescendantCodes(parentIdStr, visited = new Set()) {
    if (visited.has(parentIdStr)) return new Set();
    visited.add(parentIdStr);

    const codes = new Set();
    const children = byParent.get(parentIdStr) || [];
    for (const d of children) {
      if (String(d.id) === parentIdStr) continue; // skip self-reference
      const code = codeMap.get(d.id);
      if (code) {
        codes.add(code);
      } else {
        for (const sc of getDescendantCodes(String(d.id), visited)) {
          codes.add(sc);
        }
      }
    }
    return codes;
  }

  return allDocs.map(d => {
    const isoCode = codeMap.get(d.id);
    const isSelfRef = d.parentId === String(d.id);

    let type;
    let countryCodes;

    if (isoCode) {
      type = 'country';
      countryCodes = [isoCode];
    } else {
      type = 'region';
      countryCodes = [...getDescendantCodes(String(d.id))].sort();
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
}

// --- TTL cache for the whole built dataset ---
let cache = { data: null, builtAt: 0 };
const TTL_MS = 30 * 60 * 1000; // 30 min — shorter than the DB's 6h refresh

async function getDestinationData() {
  const now = Date.now();
  if (cache.data && now - cache.builtAt < TTL_MS) {
    return cache.data;
  }
  const allDocs = await destinations
    .find({ active: true }, { maxTimeMS: 15_000 })
    .project({ _id: 0, id: 1, name: 1, active: 1, parentId: 1 })
    .toArray();

  const data = buildData(allDocs);
  cache = { data, builtAt: now };
  return data;
}

// GET /api/destinations
router.get('/', async (_req, res, next) => {
  try {
    const data = await getDestinationData();
    res.json({ total: data.length, data });
  } catch (err) {
    next(err);
  }
});

export default router;