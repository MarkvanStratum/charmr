// Get all messages for the logged-in user across all girls
app.get("/api/messages", authenticateToken, (req, res) => {
  const userId = req.user.id; // from token
  const userMessages = {};
  for (const chatKey in messages) {
    if (chatKey.startsWith(userId + "-")) {
      userMessages[chatKey] = messages[chatKey];
    }
  }
  res.json(userMessages);
});

// Get messages for a specific girl
app.get("/api/messages/:girlId", authenticateToken, (req, res) => {
  const userId = req.user.id; // from token
  const { girlId } = req.params;
  const chatKey = `${userId}-${girlId}`;
  res.json(messages[chatKey] || []);
});
