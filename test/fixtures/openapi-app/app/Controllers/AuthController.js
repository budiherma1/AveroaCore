export default {
  login(req, res) {
    res.json({ status: true, data: { body: req.body, query: req.validated.query ?? null } });
  },
  me(req, res) {
    res.json({ status: true, data: { id: 1 } });
  },
};
