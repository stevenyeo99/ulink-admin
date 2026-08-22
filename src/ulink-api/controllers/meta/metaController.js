function getRoot(req, res) {
  res.json({ name: 'ulink-api', message: 'Welcome to ULINK API' });
}

function getHealth(req, res) {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
}

module.exports = { getRoot, getHealth };
