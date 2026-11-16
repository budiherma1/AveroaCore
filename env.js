import dotenv from 'dotenv';
import { appPath } from '@averoa/utilities/paths';

/**
 * Load the application's `.env` (from the app root, not from the current
 * working directory, which differs when knex changes cwd or when the app is
 * started from another folder). Variables already present in process.env win.
 */
dotenv.config({ path: appPath('.env'), quiet: true });

export default dotenv;
