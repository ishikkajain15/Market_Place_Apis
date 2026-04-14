import { Router } from 'express';
import countries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json' with { type: 'json' };
import { db } from '../db.js';

countries.registerLocale(enLocale);

const router = Router();
const destinations = db.collection('destination_masters');
const ports = db.collection('port_masters');

const destinationProjection = { _id: 0, id: 1, name: 1, active: 1, parentId: 1, grandParentId: 1 };

// Resolve a destination name (e.g. "Norway") into an ISO-2 country code (e.g. "NO").
// Returns null if the name doesn't correspond to a country (e.g. "Europe", "Caribbean").
function nameToIsoCode(name) {
  if (!name) return null;
  return countries.getAlpha2Code(name, 'en') || null;
}

// Given a destination, find every destination in its subtree (itself + descendants).
// Handles self-referencing roots (Europe: parentId "15" points to its own id 15).
async function findSubtree(destination) {
  const idStr = String(destination.id);
  const isSelfRoot = destination.parentId === idStr;

  const query = isSelfRoot
    ? {
        $or: [{ parentId: idStr }, { grandParentId: idStr }],
        id: { $ne: destination.id }, // exclude the self-pointing root itself
        active: true,
      }
    : {
        $or: [{ id: destination.id }, { parentId: idStr }, { grandParentId: idStr }],
        active: true,
      };

  const descendants = await destinations
    .find(query, { projection: destinationProjection })
    .toArray();

  // For leaf countries (no descendants), the query returns just itself.
  // For self-roots, we excluded self above, so add it back if it's a valid country.
  if (isSelfRoot) descendants.unshift(destination);

  return descendants;
}

// Classify a destination: "country" if its name resolves to an ISO code, else "region".
function classify(destination) {
  return nameToIsoCode(destination.name) ? 'country' : 'region';
}

// Collect unique country codes from a list of destinations.
function collectCountryCodes(destList) {
  const codes = new Set();
  for (const d of destList) {
    const code = nameToIsoCode(d.name);
    if (code) codes.add(code);
  }
  return [...codes];
}

// Fetch all active ports belonging to a given list of country codes.
async function fetchPortsByCountryCodes(codes) {
  if (codes.length === 0) return [];
  const docs = await ports
    .find(
      { 'settings.countryId': { $in: codes }, active: true },
      { projection: { _id: 0, code: 1, name: 1, settings: 1 } }
    )
    .toArray();

  // Flatten the settings block into a cleaner shape.
  return docs.map(p => ({
    code: p.code,
    name: p.name,
    latitude: p.settings?.lattitude ?? null, // note: source misspells "latitude"
    longitude: p.settings?.longitude ?? null,
    countryId: p.settings?.countryId ?? null,
  }));
}

// GET /api/destinations?limit=50&skip=0
// Lean list: no full ports, just counts + countryCodes per destination.
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 500, 500);
    const skip = Math.max(Number(req.query.skip) || 0, 0);

    const [page, total] = await Promise.all([
      destinations
        .find({ active: true }, { projection: destinationProjection, maxTimeMS: 15_000 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      destinations.estimatedDocumentCount(),
    ]);

    // For each destination, compute type, country codes, and a cheap port count.
    const data = await Promise.all(
      page.map(async (dest) => {
        const type = classify(dest);
        let codes;

        if (type === 'country') {
          codes = [nameToIsoCode(dest.name)];
        } else {
          const subtree = await findSubtree(dest);
          codes = collectCountryCodes(subtree);
        }

        const portCount = codes.length > 0
          ? await ports.countDocuments({ 'settings.countryId': { $in: codes }, active: true })
          : 0;

        return {
          id: dest.id,
          name: dest.name,
          active: dest.active,
          type,
          countryCodes: codes,
          portCount,
        };
      })
    );

    res.json({ total, count: data.length, limit, skip, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/destinations/:id
// Full detail: includes all ports for the destination (or its subtree if region).
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(404).json({ error: 'Destination not found' });
    }

    const dest = await destinations.findOne({ id }, { projection: destinationProjection });
    if (!dest) {
      return res.status(404).json({ error: 'Destination not found' });
    }

    const type = classify(dest);

    // Resolve country codes — directly for a country, via subtree for a region.
    let codes;
    if (type === 'country') {
      codes = [nameToIsoCode(dest.name)].filter(Boolean);
    } else {
      const subtree = await findSubtree(dest);
      codes = collectCountryCodes(subtree);
    }

    // Parent info for context (if it isn't self).
    let parent = null;
    if (dest.parentId && dest.parentId !== String(dest.id)) {
      const parentDoc = await destinations.findOne(
        { id: Number(dest.parentId) },
        { projection: { _id: 0, id: 1, name: 1 } }
      );
      if (parentDoc) parent = parentDoc;
    }

    const portList = await fetchPortsByCountryCodes(codes);

    res.json({
      id: dest.id,
      name: dest.name,
      active: dest.active,
      type,
      parent,
      countryCodes: codes,
      portCount: portList.length,
      ports: portList,
    });
  } catch (err) {
    next(err);
  }
});

export default router;