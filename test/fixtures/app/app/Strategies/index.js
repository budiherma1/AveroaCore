import passport from 'passport';

export const configured = { count: 0 };

export const FixtureStrategy = {
  config() {
    configured.count += 1;
    // session (de)serialization so tests can log in with a cookie session
    passport.serializeUser((user, done) => done(null, user.id));
    passport.deserializeUser((id, done) => done(null, { id }));
  },
};
