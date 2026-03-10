import cors from 'cors';

const rawWhitelist = process.env.CORS_WHITELIST?.trim();
const whitelist = rawWhitelist
  ? rawWhitelist.split(',').map(origin => origin.trim()).filter(Boolean)
  : null;

function isAllowedOrigin(origin) {
  if (!origin) return true; // allow non-browser requests

  // if no whitelist provided, allow all origins
  if (!whitelist || whitelist.length === 0) return true;

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
