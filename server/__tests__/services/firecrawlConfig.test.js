const {
    getFirecrawlApiKey,
    getMissingScrapeEnv
} = require('../../services/firecrawlConfig');

describe('firecrawlConfig', () => {
    test('prefers FIRECRAWL_API_KEY when present', () => {
        const env = {
            FIRECRAWL_API_KEY: 'new-key',
            Firecrawl_Api_Key: 'old-key'
        };

        expect(getFirecrawlApiKey(env)).toBe('new-key');
    });

    test('falls back to legacy Firecrawl_Api_Key', () => {
        const env = {
            Firecrawl_Api_Key: 'old-key'
        };

        expect(getFirecrawlApiKey(env)).toBe('old-key');
    });

    test('reports missing FIRECRAWL_API_KEY when neither name is configured', () => {
        const env = {
            SUPABASE_URL: 'https://test.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: 'service-role'
        };

        expect(getMissingScrapeEnv(env)).toEqual(['FIRECRAWL_API_KEY']);
    });

    test('treats Firecrawl config as satisfied when either env name exists', () => {
        const env = {
            SUPABASE_URL: 'https://test.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: 'service-role',
            Firecrawl_Api_Key: 'old-key'
        };

        expect(getMissingScrapeEnv(env)).toEqual([]);
    });
});
