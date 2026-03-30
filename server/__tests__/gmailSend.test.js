const request = require('supertest');

// --- Mocks ---

jest.mock('../middleware/auth', () => ({
    requireAuth: (req, res, next) => {
        req.userId = 'test-user-id';
        req.userEmail = 'testuser@gmail.com';
        next();
    }
}));

jest.mock('@supabase/supabase-js', () => ({
    createClient: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: null, error: null }),
            upsert: jest.fn().mockResolvedValue({ error: null })
        })
    })
}));

jest.mock('@mendable/firecrawl-js', () => ({
    default: jest.fn().mockImplementation(() => ({
        scrapeUrl: jest.fn().mockResolvedValue({ success: false }),
        search: jest.fn().mockResolvedValue({ success: false })
    }))
}));

jest.mock('pdf2json', () => {
    const EventEmitter = require('events').EventEmitter;
    return jest.fn().mockImplementation(() => {
        const emitter = new EventEmitter();
        emitter.parseBuffer = jest.fn();
        return emitter;
    });
});

global.fetch = jest.fn();

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.CLAUDE_API_KEY = 'test-claude-key';
process.env.FIRECRAWL_API_KEY = 'test-firecrawl-key';

const app = require('../index');


// =========================================================
// POST /gmail/send
// =========================================================

describe('POST /gmail/send', () => {
    beforeEach(() => {
        global.fetch.mockReset();
    });

    test('returns 400 if provider_token is missing', async () => {
        const res = await request(app)
            .post('/gmail/send')
            .set('Authorization', 'Bearer test-token')
            .send({ drafts: [{ email: 'a@b.com', subject: 'Hi', body: 'Hello' }] });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/provider_token/i);
    });

    test('returns 400 if drafts is empty or missing', async () => {
        const res = await request(app)
            .post('/gmail/send')
            .set('Authorization', 'Bearer test-token')
            .send({ provider_token: 'gtoken', drafts: [] });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/drafts/i);
    });

    test('returns 400 if drafts exceeds 10', async () => {
        const drafts = Array.from({ length: 11 }, (_, i) => ({
            email: `prof${i}@uni.edu`,
            subject: 'Hi',
            body: 'Hello'
        }));

        const res = await request(app)
            .post('/gmail/send')
            .set('Authorization', 'Bearer test-token')
            .send({ provider_token: 'gtoken', drafts });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/10/);
    });

    test('sends emails successfully via Gmail API', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ id: 'msg-123' })
        });

        const res = await request(app)
            .post('/gmail/send')
            .set('Authorization', 'Bearer test-token')
            .send({
                provider_token: 'gtoken',
                drafts: [
                    { email: 'prof@uni.edu', subject: 'Research inquiry', body: 'I am interested in your work.' }
                ]
            });

        expect(res.status).toBe(200);
        expect(res.body.results).toHaveLength(1);
        expect(res.body.results[0].success).toBe(true);
        expect(res.body.results[0].messageId).toBe('msg-123');
        expect(res.body.sent).toBe(1);
        expect(res.body.total).toBe(1);

        // Verify Gmail API was called with correct auth
        expect(global.fetch).toHaveBeenCalledWith(
            'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'Authorization': 'Bearer gtoken'
                })
            })
        );
    });

    test('handles partial failure gracefully', async () => {
        global.fetch
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ id: 'msg-1' })
            })
            .mockResolvedValueOnce({
                ok: false,
                json: () => Promise.resolve({ error: { message: 'Invalid grant' } })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ id: 'msg-3' })
            });

        const res = await request(app)
            .post('/gmail/send')
            .set('Authorization', 'Bearer test-token')
            .send({
                provider_token: 'gtoken',
                drafts: [
                    { email: 'a@uni.edu', subject: 'Hi', body: 'Hello' },
                    { email: 'b@uni.edu', subject: 'Hi', body: 'Hello' },
                    { email: 'c@uni.edu', subject: 'Hi', body: 'Hello' }
                ]
            });

        expect(res.status).toBe(200);
        expect(res.body.sent).toBe(2);
        expect(res.body.total).toBe(3);
        expect(res.body.results[0].success).toBe(true);
        expect(res.body.results[1].success).toBe(false);
        expect(res.body.results[1].error).toBe('Invalid grant');
        expect(res.body.results[2].success).toBe(true);
    });

    test('skips drafts with missing fields', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ id: 'msg-ok' })
        });

        const res = await request(app)
            .post('/gmail/send')
            .set('Authorization', 'Bearer test-token')
            .send({
                provider_token: 'gtoken',
                drafts: [
                    { email: '', subject: 'Hi', body: 'Hello' },
                    { email: 'ok@uni.edu', subject: 'Hi', body: 'Hello' }
                ]
            });

        expect(res.status).toBe(200);
        expect(res.body.results[0].success).toBe(false);
        expect(res.body.results[0].error).toMatch(/missing/i);
        expect(res.body.results[1].success).toBe(true);
    });

    test('constructs valid RFC 2822 message with correct headers', async () => {
        let sentBody = null;
        global.fetch.mockImplementation((url, opts) => {
            sentBody = JSON.parse(opts.body);
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ id: 'msg-test' })
            });
        });

        await request(app)
            .post('/gmail/send')
            .set('Authorization', 'Bearer test-token')
            .send({
                provider_token: 'gtoken',
                drafts: [{ email: 'test@uni.edu', subject: 'Test Subject', body: 'Test body content' }]
            });

        // Decode the base64url raw message
        const raw = sentBody.raw
            .replace(/-/g, '+')
            .replace(/_/g, '/');
        const decoded = Buffer.from(raw, 'base64').toString('utf-8');

        expect(decoded).toContain('From: testuser@gmail.com');
        expect(decoded).toContain('To: test@uni.edu');
        expect(decoded).toContain('Subject: Test Subject');
        expect(decoded).toContain('Content-Type: text/plain; charset="UTF-8"');
        expect(decoded).toContain('Test body content');
    });

    test('handles Gmail API network error', async () => {
        global.fetch.mockRejectedValue(new Error('Network error'));

        const res = await request(app)
            .post('/gmail/send')
            .set('Authorization', 'Bearer test-token')
            .send({
                provider_token: 'gtoken',
                drafts: [{ email: 'prof@uni.edu', subject: 'Hi', body: 'Hello' }]
            });

        expect(res.status).toBe(200);
        expect(res.body.results[0].success).toBe(false);
        expect(res.body.results[0].error).toBe('Network error');
    });
});
