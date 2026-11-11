/**
 * Import this FIRST in a spec that needs email-verification enforcement: Nest's ConfigModule reads the
 * environment when `AppModule` is imported, so the variables must be set before the app module loads.
 */
process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
process.env.EMAIL_VERIFICATION_RESEND_COOLDOWN = '1h';
