const crypto = require('crypto');

let jwtSecret;

if (process.env.JWT_SECRET) {
  jwtSecret = process.env.JWT_SECRET;
} else {
  jwtSecret = crypto.randomBytes(64).toString('hex');
  console.warn('⚠️  WARNING: JWT_SECRET environment variable is not set!');
  console.warn('⚠️  A random secret has been generated for this session.');
  console.warn('⚠️  All existing tokens will be invalidated on restart.');
  console.warn('⚠️  Set JWT_SECRET in your .env file for production use.');
}

module.exports = jwtSecret;
