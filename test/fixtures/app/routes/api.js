import express from 'express';

// Plain object with init() → express.Router, so these tests don't depend on
// @averoa/routes.
export default {
  async init() {
    const router = express.Router();
    router.get('/ping', (req, res) => res.json({ pong: true }));
    router.post('/echo', (req, res) => res.json({ body: req.body }));
    router.get('/csrf-token', (req, res) => res.json({ token: req.csrfToken() }));
    router.get('/boom', async () => {
      throw new Error('api exploded');
    });
    return router;
  },
};
