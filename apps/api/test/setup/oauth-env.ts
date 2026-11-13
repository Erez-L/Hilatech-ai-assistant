/** Import FIRST in a spec that needs social sign-in: the environment is read when `AppModule` loads. */
process.env.OAUTH_GOOGLE_CLIENT_ID = 'test-google-id';
process.env.OAUTH_GOOGLE_CLIENT_SECRET = 'test-google-secret';
process.env.OAUTH_FACEBOOK_CLIENT_ID = 'test-facebook-id';
process.env.OAUTH_FACEBOOK_CLIENT_SECRET = 'test-facebook-secret';
