// Scaffold controller, not wired to a real service yet — replace when a Users module exists.
function listUsers(req, res) {
  res.json({ data: [] });
}

module.exports = { listUsers };
