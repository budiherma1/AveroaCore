export const calls = { beginning: 0, end: 0, session: 0, helmet: 0 };

export const AppProvider = {
  beginning() {
    calls.beginning += 1;
  },
  end(app) {
    calls.end += 1;
    app.get('/from-end', (req, res) => res.json({ end: true }));
  },
  session() {
    calls.session += 1;
    return { name: 'fixture.sid' };
  },
  helmet(defaults) {
    calls.helmet += 1;
    return defaults;
  },
};

export const ViewProvider = {
  global() {
    return { greeting: 'Hello' };
  },
};
