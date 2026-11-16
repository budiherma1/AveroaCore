export default {
  findAll(req, res) { res.json({ status: true, metadata: {}, data: [] }); },
  findOne(req, res) { res.json({ status: true, data: {} }); },
  create(req, res) { res.status(201).json({ status: true, data: req.body }); },
  update(req, res) { res.json({ status: true }); },
  delete(req, res) { res.json({ status: true }); },
  internal(req, res) { res.json({ ok: true }); },
};
