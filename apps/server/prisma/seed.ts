import { provisionDemoUser, DEMO_EMAIL } from '../src/modules/auth/demo.js';

async function main(): Promise<void> {
  await provisionDemoUser();
  console.log(`Seeded demo account (${DEMO_EMAIL}) with starter library.`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
