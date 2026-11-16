export default {
  handle(req, res, next) {
    if (req.headers.authorization !== 'Bearer good') return res.status(401).json({ status: false, message: 'Unauthorized' });
    return next();
  },
};
