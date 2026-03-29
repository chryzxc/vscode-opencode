#!/usr/bin/env node
/**
 * Test what QuotaService.refreshQuota() actually returns
 */

import { QuotaService } from './src/services/QuotaService.js';

const service = new QuotaService();

console.log('Calling QuotaService.refreshQuota()...\n');

const result = await service.refreshQuota();

console.log('Result:');
console.log(JSON.stringify(result, null, 2));

console.log('\n\nPlatform count:', result.platforms.length);
console.log('\nPlatforms:');
result.platforms.forEach((p, i) => {
  console.log(`\n[${i}] Platform: ${p.platform}`);
  console.log(`    Account: ${p.account}`);
  console.log(`    Status: ${p.status}`);
  console.log(`    Title: ${p.title || '(none)'}`);
  if (p.error) {
    console.log(`    Error: ${p.error}`);
  }
  console.log(`    Quotas: ${p.quotas.length} items`);
  p.quotas.forEach((q, j) => {
    console.log(`      [${j}] ${q.label}: ${q.remainPercent}%`);
  });
});

service.dispose();
