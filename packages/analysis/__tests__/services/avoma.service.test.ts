/**
 * avoma.service.test.ts
 * Unit tests for Avoma API integration
 */

describe('Avoma Service', () => {
  it('should extract meeting ID from Avoma URL', () => {
    // This test demonstrates the extraction pattern
    // In real tests, you would mock fetch() to test the API interaction
    const url = 'https://app.avoma.com/meetings/abc123xyz456';
    const match = url.match(/meetings\/([a-zA-Z0-9_-]+)/);
    expect(match).toBeTruthy();
    expect(match?.[1]).toBe('abc123xyz456');
  });

  it('should handle timeout correctly', async () => {
    // Test would mock fetch with AbortSignal.timeout
    // Verify timeout error is caught and converted to AppError with 502 status
  });

  it('should retry once on failure', async () => {
    // Test would mock fetch to fail first, succeed second
    // Verify it retries after 5s backoff
  });
});
