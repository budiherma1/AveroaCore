import cors from 'cors';

const whitelist = process.env.CORS_WHITELIST
  ?.split(',')
  .map(origin => origin.trim());

function isAllowedOrigin(origin) {
  if (!origin) return true; // allow non-browser requests

  return whitelist.some(allowed => {
    // exact match
    if (!allowed.includes('*')) {
      return origin === allowed;
    }

    // wildcard match (*.domain.com)
    const regex = new RegExp(
      '^https?:\\/\\/([a-z0-9-]+\\.)?' +
      allowed.replace('*.', '').replace('.', '\\.') +
      '$',
      'i'
    );

    return regex.test(origin);
  });
}

const corsOptions = {
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
};

export default cors(corsOptions);
