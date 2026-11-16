import express from 'express';

export default {
  async init() {
    const router = express.Router();
    router.get('/csrf', (req, res) => res.json({ token: req.csrfToken() }));
    router.post('/submit', (req, res) => res.json({ ok: true, body: req.body }));
    router.get('/view', (req, res) => res.render('pages.hello', { name: 'Averoa' }));
    router.get('/view-slash', (req, res) => res.render('pages/hello', { name: 'Slash' }));
    router.get('/view-plain', (req, res) => res.render('pages.plain', { name: 'Plain' }));
    router.get('/locals-token', (req, res) => res.json({ type: typeof res.locals.csrfToken, same: res.locals.csrfToken === req.csrfToken() }));
    // test-only login: puts a passport user in the session
    router.get('/login-test', (req, res, next) => {
      req.login({ id: 7 }, (err) => (err ? next(err) : res.json({ user: req.user })));
    });
    router.get('/boom', () => {
      throw new Error('secret internals');
    });
    return router;
  },
};
