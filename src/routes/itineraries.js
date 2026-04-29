import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const itineraries = db.collection('cruise_itineraries');

// GET /api/itineraries/:id
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(404).json({ error: 'Itinerary not found' });
    }

    const doc = await itineraries.findOne(
      { id },
      { projection: { _id: 0, createdOn: 0, modifiedOn: 0 } }
    );

    if (!doc) {
      return res.status(404).json({ error: 'Itinerary not found' });
    }

    res.json(doc);
  } catch (err) {
    next(err);
  }
});

export default router;