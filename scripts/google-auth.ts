import { startAuthFlow, getUserEmail } from '../src/backend/google-auth.js';
import { insertDestination } from '../src/backend/db.js';
import { v4 as uuidv4 } from 'uuid';

async function main() {
  console.log('Starting Google authorization...');
  console.log('A browser window will open. Sign in with the Google account you want to connect.\n');

  try {
    const tokens = await startAuthFlow();
    const email = await getUserEmail(tokens.access_token);

    console.log(`\nConnected Google account: ${email}`);
    console.log('Saving credentials...');

    // Save as a destination
    const id = uuidv4();
    insertDestination({
      id,
      type: 'google',
      name: `Google Drive (${email})`,
      config: {
        email,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      },
    });

    console.log('\nSuccess! Google account connected.');
    console.log('You can now add specific folders/docs as destinations in the app.');
    process.exit(0);
  } catch (err) {
    console.error('Authorization failed:', err);
    process.exit(1);
  }
}

main();
