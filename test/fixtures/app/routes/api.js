import express from 'express';
import { currentRequestId } from '../../../../request-id.js';

// Plain object with init() → express.Router, so these tests don't depend on
// @averoa/routes.
export default {
  async init() {
    const router = express.Router();
    router.get('/ping', (req, res) => res.json({ pong: true }));
    router.post('/echo', (req, res) => res.json({ body: req.body }));
    router.get('/csrf-token', (req, res) => res.json({ token: req.csrfToken() }));
    // request context across async boundaries (observability tests)
    router.post('/context', async (req, res) => {
      const seen = { start: currentRequestId() };
      await new Promise((resolve) => { setTimeout(resolve, 5); });
      seen.timer = currentRequestId();
      await new Promise((resolve) => { setImmediate(resolve); });
      seen.immediate = currentRequestId();
      seen.promise = await Promise.resolve().then(() => currentRequestId());
      res.json({ id: req.id, seen, body: req.body });
    });
    router.get('/boom', async () => {
      throw new Error('api exploded');
    });
    return router;
  },
};
