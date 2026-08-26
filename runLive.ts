/**
 * runLive.ts — Single-event live demo script.
 *
 * Demonstrates the full recovery pipeline end-to-end against
 * Razorpay Test Mode API with step-by-step console output.
 *
 * Usage:
 *   npx tsx runLive.ts
 *
 * Prerequisites:
 *   - DRY_RUN=false in .env
 *   - RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET set in .env
 *   - GEMINI_API_KEY set in .env
 */

import { runLiveDemo } from './src/demoRunner.js';

runLiveDemo((msg) => {
  process.stdout.write(msg);
}).catch(err => {
  console.error('\n❌ Demo failed with error:', err);
  process.exit(1);
});
