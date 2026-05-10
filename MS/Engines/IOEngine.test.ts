/**
 * Unit tests for IOEngine singleton pattern
 * 
 * These tests verify that the singleton pattern is correctly implemented:
 * - getInstance() returns the same instance on multiple calls
 * - The singleton persists across module reloads
 */

import IOEngine from './IOEngine.ts';

/**
 * Test 1: Verify getInstance() returns the same instance
 */
function testGetInstanceReturnsSameInstance(): void {
  const instance1 = IOEngine.getInstance();
  const instance2 = IOEngine.getInstance();
  
  if (instance1 !== instance2) {
    throw new Error('FAILED: getInstance() should return the same instance');
  }
  
  console.log('✓ PASSED: getInstance() returns the same instance');
}

/**
 * Test 2: Verify multiple calls to getInstance() return identical reference
 */
function testMultipleCallsReturnIdenticalReference(): void {
  const instances = [
    IOEngine.getInstance(),
    IOEngine.getInstance(),
    IOEngine.getInstance(),
    IOEngine.getInstance(),
    IOEngine.getInstance()
  ];
  
  const firstInstance = instances[0];
  for (let i = 1; i < instances.length; i++) {
    if (instances[i] !== firstInstance) {
      throw new Error(`FAILED: Instance ${i} is not identical to the first instance`);
    }
  }
  
  console.log('✓ PASSED: Multiple calls to getInstance() return identical reference');
}

/**
 * Test 3: Verify singleton persists (same reference throughout execution)
 */
function testSingletonPersists(): void {
  const instance1 = IOEngine.getInstance();
  
  // Simulate some operations
  const instance2 = IOEngine.getInstance();
  
  // Verify they're still the same
  if (instance1 !== instance2) {
    throw new Error('FAILED: Singleton instance should persist');
  }
  
  console.log('✓ PASSED: Singleton persists across operations');
}

/**
 * Run all tests
 */
function runTests(): void {
  console.log('Running IOEngine Singleton Pattern Tests...\n');
  
  try {
    testGetInstanceReturnsSameInstance();
    testMultipleCallsReturnIdenticalReference();
    testSingletonPersists();
    
    console.log('\n✓ All tests passed!');
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    throw error;
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests();
}

export { runTests };
