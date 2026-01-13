const jwt = require('jsonwebtoken');

// Config from .env
const SECRET_KEY = "your-secret-key-change-this-in-production-min-32-chars-long";
const ALGORITHM = "HS256";

// Payload based on requirements
const payload = {
  sub: "1", // user_id
  restaurant_id: 52, // Example restaurant ID
  exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24), // 24 hours
};

const token = jwt.sign(payload, SECRET_KEY, { algorithm: ALGORITHM });

console.log("\n=== Generated Access Token ===");
console.log(token);
console.log("==============================\n");
console.log("Restaurant ID: 52");
