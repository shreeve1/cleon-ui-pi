/**
 * Unit tests for /api/health endpoint
 *
 * Tests that the health endpoint returns the expected JSON structure:
 * - status: 'ok'
 * - uptime: number (seconds since server start)
 * - timestamp: ISO 8601 timestamp
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import http from 'http';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Creates a test Express app with the health endpoint
 * @param {number} mockStartTime - Mock server start time in milliseconds
 * @returns {object} Express app instance
 */
function createTestApp(mockStartTime = Date.now()) {
  const app = express();

  // Health check endpoint (mirrors server/index.js implementation)
  app.get('/api/health', (req, res) => {
    const uptime = Math.floor((Date.now() - mockStartTime) / 1000);
    res.json({
      status: 'ok',
      uptime,
      timestamp: new Date().toISOString()
    });
  });

  return app;
}

/**
 * Makes a request to the test app and returns the response
 * @param {express.Application} app - Express app instance
 * @returns {Promise<object>} Response object with status and body
 */
function makeHealthRequest(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;

      const req = http.request({
        hostname: 'localhost',
        port,
        path: '/api/health',
        method: 'GET'
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          server.close(() => {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: JSON.parse(data)
            });
          });
        });
      });

      req.on('error', reject);
      req.end();
    });
  });
}

// ===========================================================================
// 1. Response Structure Tests
// ===========================================================================
describe('Health Endpoint - Response Structure', () => {
  it('returns 200 OK status', async () => {
    const app = createTestApp();
    const response = await makeHealthRequest(app);

    expect(response.status).toBe(200);
  });

  it('returns Content-Type: application/json', async () => {
    const app = createTestApp();
    const response = await makeHealthRequest(app);

    expect(response.headers['content-type']).toMatch(/application\/json/);
  });

  it('returns status field with value "ok"', async () => {
    const app = createTestApp();
    const response = await makeHealthRequest(app);

    expect(response.body).toHaveProperty('status', 'ok');
  });

  it('returns uptime field as a number', async () => {
    const app = createTestApp();
    const response = await makeHealthRequest(app);

    expect(response.body).toHaveProperty('uptime');
    expect(typeof response.body.uptime).toBe('number');
  });

  it('returns timestamp field as ISO 8601 string', async () => {
    const app = createTestApp();
    const response = await makeHealthRequest(app);

    expect(response.body).toHaveProperty('timestamp');
    expect(typeof response.body.timestamp).toBe('string');

    // Verify it's a valid ISO 8601 timestamp
    const timestamp = new Date(response.body.timestamp);
    expect(timestamp.toISOString()).toBe(response.body.timestamp);
  });

  it('returns exactly the expected fields (status, uptime, timestamp)', async () => {
    const app = createTestApp();
    const response = await makeHealthRequest(app);

    const expectedKeys = ['status', 'uptime', 'timestamp'];
    expect(Object.keys(response.body).sort()).toEqual(expectedKeys.sort());
  });
});

// ===========================================================================
// 2. Uptime Calculation Tests
// ===========================================================================
describe('Health Endpoint - Uptime Calculation', () => {
  it('returns 0 uptime when just started', async () => {
    // Start time is now, so uptime should be 0 or very close to 0
    const app = createTestApp(Date.now());
    const response = await makeHealthRequest(app);

    expect(response.body.uptime).toBeGreaterThanOrEqual(0);
    expect(response.body.uptime).toBeLessThan(2); // Allow 1-2 seconds for test execution
  });

  it('returns correct uptime for server running 60 seconds', async () => {
    // Simulate server started 60 seconds ago
    const sixtySecondsAgo = Date.now() - 60000;
    const app = createTestApp(sixtySecondsAgo);
    const response = await makeHealthRequest(app);

    // Should be at least 60 seconds, allow small margin for test execution
    expect(response.body.uptime).toBeGreaterThanOrEqual(60);
    expect(response.body.uptime).toBeLessThan(65);
  });

  it('returns correct uptime for server running 1 hour', async () => {
    // Simulate server started 1 hour ago
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    const app = createTestApp(oneHourAgo);
    const response = await makeHealthRequest(app);

    // Should be at least 3600 seconds (1 hour)
    expect(response.body.uptime).toBeGreaterThanOrEqual(3600);
    expect(response.body.uptime).toBeLessThan(3610);
  });

  it('uptime is calculated in whole seconds (floor, not round)', async () => {
    // Simulate server started 5.7 seconds ago
    // Uptime should be floor(5.7) = 5 seconds
    const fivePointSevenSecondsAgo = Date.now() - 5700;
    const app = createTestApp(fivePointSevenSecondsAgo);
    const response = await makeHealthRequest(app);

    // Should be 5 or 6 depending on test execution time
    expect(response.body.uptime).toBeGreaterThanOrEqual(5);
    expect(Number.isInteger(response.body.uptime)).toBe(true);
  });
});

// ===========================================================================
// 3. Timestamp Tests
// ===========================================================================
describe('Health Endpoint - Timestamp', () => {
  it('returns current timestamp within 1 second of now', async () => {
    const beforeRequest = Date.now();
    const app = createTestApp();
    const response = await makeHealthRequest(app);
    const afterRequest = Date.now();

    const responseTime = new Date(response.body.timestamp).getTime();

    expect(responseTime).toBeGreaterThanOrEqual(beforeRequest - 1000);
    expect(responseTime).toBeLessThanOrEqual(afterRequest + 1000);
  });

  it('returns different timestamps on successive requests', async () => {
    const app = createTestApp();

    const response1 = await makeHealthRequest(app);

    // Wait a bit to ensure different timestamp
    await new Promise(resolve => setTimeout(resolve, 100));

    const response2 = await makeHealthRequest(app);

    // Timestamps should be different (or at least the second one should be >= first)
    const time1 = new Date(response1.body.timestamp).getTime();
    const time2 = new Date(response2.body.timestamp).getTime();

    expect(time2).toBeGreaterThanOrEqual(time1);
  });
});

// ===========================================================================
// 4. Integration Tests
// ===========================================================================
describe('Health Endpoint - Integration', () => {
  it('can be called multiple times successfully', async () => {
    const app = createTestApp(Date.now() - 10000);

    const responses = await Promise.all([
      makeHealthRequest(app),
      makeHealthRequest(app),
      makeHealthRequest(app)
    ]);

    responses.forEach(response => {
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  it('uptime increases between requests', async () => {
    const startTime = Date.now() - 5000; // Started 5 seconds ago
    const app = createTestApp(startTime);

    const response1 = await makeHealthRequest(app);

    // Wait 2 seconds
    await new Promise(resolve => setTimeout(resolve, 2000));

    const response2 = await makeHealthRequest(app);

    // Uptime should have increased by at least 2 seconds
    expect(response2.body.uptime).toBeGreaterThan(response1.body.uptime);
    expect(response2.body.uptime - response1.body.uptime).toBeGreaterThanOrEqual(2);
  });
});
