const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({ name: 'ulink-api', message: 'Welcome to ULINK API' });
});

module.exports = router;
