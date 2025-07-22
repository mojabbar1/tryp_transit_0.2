#!/usr/bin/env tsx

/**
 * API Testing Script for FREE BEER Transit Incentives
 * 
 * This script tests all beer rewards APIs to ensure they work correctly
 */

import { logger } from '../lib/logger';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

interface TestResult {
  endpoint: string;
  method: string;
  status: 'PASS' | 'FAIL';
  responseTime: number;
  error?: string;
}

async function testAPI(endpoint: string, method: string = 'GET', body?: any): Promise<TestResult> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const responseTime = Date.now() - startTime;

    if (response.ok) {
      const data = await response.json();
      console.log(`✅ ${method} ${endpoint} - ${response.status} (${responseTime}ms)`);
      return {
        endpoint,
        method,
        status: 'PASS',
        responseTime
      };
    } else {
      const errorText = await response.text();
      console.log(`❌ ${method} ${endpoint} - ${response.status} (${responseTime}ms): ${errorText}`);
      return {
        endpoint,
        method,
        status: 'FAIL',
        responseTime,
        error: `HTTP ${response.status}: ${errorText}`
      };
    }
  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`❌ ${method} ${endpoint} - ERROR (${responseTime}ms): ${errorMessage}`);
    return {
      endpoint,
      method,
      status: 'FAIL',
      responseTime,
      error: errorMessage
    };
  }
}

async function testBeerRewardsAPIs() {
  console.log('🍺 Testing FREE BEER Transit Incentives APIs...');
  console.log(`🌐 Base URL: ${API_BASE_URL}`);
  console.log('');

  const results: TestResult[] = [];

  // Test 1: Rewards Status API for Alice (should show 6/7 beer progress)
  console.log('📊 Testing Rewards Status API...');
  results.push(await testAPI('/api/rewards/alice-demo'));
  results.push(await testAPI('/api/rewards/bob-demo'));
  results.push(await testAPI('/api/rewards/carol-demo'));
  console.log('');

  // Test 2: Trip Completion API
  console.log('🚌 Testing Trip Completion API...');
  results.push(await testAPI('/api/complete-trip', 'POST', {
    userId: 'test-user',
    userName: 'Test User'
  }));
  console.log('');

  // Test 3: Transit Insights API (with beer nudging)
  console.log('💡 Testing Transit Insights API...');
  results.push(await testAPI('/api/transit-insights', 'POST', {
    userId: 'alice-demo',
    userName: 'Alice Johnson'
  }));
  console.log('');

  // Test 4: Invalid requests (should fail gracefully)
  console.log('🛡️  Testing Error Handling...');
  results.push(await testAPI('/api/rewards/invalid-user'));
  results.push(await testAPI('/api/complete-trip', 'POST', {})); // Missing required fields
  console.log('');

  // Summary
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const avgResponseTime = results.reduce((sum, r) => sum + r.responseTime, 0) / results.length;

  console.log('📈 Test Summary:');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⏱️  Average Response Time: ${Math.round(avgResponseTime)}ms`);
  console.log('');

  if (failed === 0) {
    console.log('🎉 All tests passed! Beer rewards APIs are working correctly.');
  } else {
    console.log('⚠️  Some tests failed. Check the errors above.');
    
    // Log failed tests
    const failedTests = results.filter(r => r.status === 'FAIL');
    failedTests.forEach(test => {
      console.log(`   - ${test.method} ${test.endpoint}: ${test.error}`);
    });
  }

  // Log test results
  logger.apiEvent('api_tests_completed', {
    totalTests: results.length,
    passed,
    failed,
    avgResponseTime: Math.round(avgResponseTime),
    results: results.map(r => ({
      endpoint: r.endpoint,
      method: r.method,
      status: r.status,
      responseTime: r.responseTime
    }))
  });

  return { passed, failed, results };
}

// Run if called directly
if (require.main === module) {
  testBeerRewardsAPIs().then(({ passed, failed }) => {
    process.exit(failed > 0 ? 1 : 0);
  });
}

export { testBeerRewardsAPIs };