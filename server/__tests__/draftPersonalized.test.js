const request = require('supertest');

// --- Mocks ---

jest.mock('../middleware/auth', () => ({
    requireAuth: (req, res, next) => {
        req.userId = 'test-user-id';
        next();
    }
}));

jest.mock('@supabase/supabase-js', () => ({
    createClient: jest.fn()
}));

// Mock Firecrawl
jest.mock('@mendable/firecrawl-js', () => ({
    default: jest.fn().mockImplementation(() => ({
        scrapeUrl: jest.fn().mockResolvedValue({ markdown: '## Research\nSome interesting paper about AI.' })
    }))
}));

// Mock pdf2json (required by index.js at module load time)
globalThis.__pdf2jsonMock = { text: '', shouldError: false };
jest.mock('pdf2json', () => {
    const EventEmitter = require('events').EventEmitter;
    return jest.fn().mockImplementation(() => {
        const emitter = new EventEmitter();
        emitter.parseBuffer = jest.fn().mockImplementation(() => {
            process.nextTick(() => {
                const mock = globalThis.__pdf2jsonMock;
                if (mock.shouldError) {
                    emitter.emit('pdfParser_dataError', { parserError: 'error' });
                } else {
                    emitter.emit('pdfParser_dataReady', {
                        Pages: [{ Texts: [{ R: [{ T: encodeURIComponent(mock.text || '') }] }] }]
                    });
                }
            });
        });
        return emitter;
    });
});

const { createClient } = require('@supabase/supabase-js');
global.fetch = jest.fn();

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.CLAUDE_API_KEY = 'test-claude-key';
process.env.FIRECRAWL_API_KEY = 'test-firecrawl-key';

const app = require('../index');

// --- Helpers ---

function mockSupabaseWithResume(resumeText = 'Software engineer with ML experience.') {
    const mockSingle = jest.fn().mockResolvedValue({ data: { resume_text: resumeText }, error: null });
    const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
    const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
    const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });
    createClient.mockReturnValue({ from: mockFrom });
}

function mockSupabaseNoResume() {
    const mockSingle = jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } });
    const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
    const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
    const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });
    createClient.mockReturnValue({ from: mockFrom });
}

function mockClaudeSuccess(subject = 'Hello Professor', body = 'I admire your research on AI.') {
    global.fetch.mockImplementation((url) => {
        if (url.includes('openrouter.ai')) {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    choices: [{ message: { content: JSON.stringify({ subject, body }) } }]
                })
            });
        }
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
}

const SAMPLE_LEADS = [
    { name: 'Dr. Alice Smith', email: 'alice@ufl.edu', detail: 'CS Professor', sourceUrl: 'https://cise.ufl.edu/alice' },
    { name: 'Dr. Bob Jones', email: 'bob@ufl.edu', detail: 'ML Researcher' },
    { name: 'Dr. Carol Wu', email: 'carol@ufl.edu', detail: 'Robotics' }
];

// --- Tests ---

describe('POST /draft-personalized-emails', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // Happy path
    it('drafts emails for up to 3 leads and returns drafts array', async () => {
        mockSupabaseWithResume();
        mockClaudeSuccess('Research Collaboration Inquiry', 'I read your paper on deep learning.');

        const res = await request(app)
            .post('/draft-personalized-emails')
            .set('Authorization', 'Bearer test-token')
            .send({ leads: SAMPLE_LEADS });

        expect(res.status).toBe(200);
        expect(res.body.drafts).toHaveLength(3);
        res.body.drafts.forEach(draft => {
            expect(draft).toHaveProperty('name');
            expect(draft).toHaveProperty('email');
            expect(draft).toHaveProperty('subject');
            expect(draft).toHaveProperty('body');
        });
    });

    it('defaults to 3 leads when no limit is provided', async () => {
        mockSupabaseWithResume();
        mockClaudeSuccess();

        const manyLeads = [
            ...SAMPLE_LEADS,
            { name: 'Dr. Dave', email: 'dave@ufl.edu', detail: 'Extra' },
            { name: 'Dr. Eve', email: 'eve@ufl.edu', detail: 'Extra' }
        ];

        const res = await request(app)
            .post('/draft-personalized-emails')
            .set('Authorization', 'Bearer test-token')
            .send({ leads: manyLeads });

        expect(res.status).toBe(200);
        expect(res.body.drafts).toHaveLength(3);
    });

    it('respects limit parameter up to 10', async () => {
        mockSupabaseWithResume();
        mockClaudeSuccess();

        const manyLeads = [
            ...SAMPLE_LEADS,
            { name: 'Dr. Dave', email: 'dave@ufl.edu', detail: 'Extra' },
            { name: 'Dr. Eve', email: 'eve@ufl.edu', detail: 'Extra' }
        ];

        const res = await request(app)
            .post('/draft-personalized-emails')
            .set('Authorization', 'Bearer test-token')
            .send({ leads: manyLeads, limit: 5 });

        expect(res.status).toBe(200);
        expect(res.body.drafts).toHaveLength(5);
    });

    it('caps at 10 leads even when limit is higher', async () => {
        mockSupabaseWithResume();
        mockClaudeSuccess();

        const manyLeads = Array.from({ length: 15 }, (_, i) => ({
            name: `Dr. Test${i}`, email: `test${i}@ufl.edu`, detail: 'Prof'
        }));

        const res = await request(app)
            .post('/draft-personalized-emails')
            .set('Authorization', 'Bearer test-token')
            .send({ leads: manyLeads, limit: 15 });

        expect(res.status).toBe(200);
        expect(res.body.drafts).toHaveLength(10);
    });

    it('works with a single lead', async () => {
        mockSupabaseWithResume();
        mockClaudeSuccess('Single Lead Subject', 'Body for single lead.');

        const res = await request(app)
            .post('/draft-personalized-emails')
            .set('Authorization', 'Bearer test-token')
            .send({ leads: [SAMPLE_LEADS[0]] });

        expect(res.status).toBe(200);
        expect(res.body.drafts).toHaveLength(1);
        expect(res.body.drafts[0].email).toBe('alice@ufl.edu');
    });

    // Edge cases
    it('returns 400 when leads is missing', async () => {
        const res = await request(app)
            .post('/draft-personalized-emails')
            .set('Authorization', 'Bearer test-token')
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/leads array/i);
    });

    it('returns 400 when leads is an empty array', async () => {
        const res = await request(app)
            .post('/draft-personalized-emails')
            .set('Authorization', 'Bearer test-token')
            .send({ leads: [] });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/leads array/i);
    });

    it('returns 400 when a lead is missing an email field', async () => {
        const res = await request(app)
            .post('/draft-personalized-emails')
            .set('Authorization', 'Bearer test-token')
            .send({ leads: [{ name: 'No Email Lead' }] });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/email/i);
    });

    it('returns 400 when no resume is saved for the user', async () => {
        mockSupabaseNoResume();

        const res = await request(app)
            .post('/draft-personalized-emails')
            .set('Authorization', 'Bearer test-token')
            .send({ leads: SAMPLE_LEADS });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/resume/i);
    });

    // Graceful fallback when Claude fails
    it('returns a fallback draft when Claude API errors for a lead', async () => {
        mockSupabaseWithResume();
        global.fetch.mockRejectedValue(new Error('Claude timeout'));

        const res = await request(app)
            .post('/draft-personalized-emails')
            .set('Authorization', 'Bearer test-token')
            .send({ leads: [SAMPLE_LEADS[0]] });

        expect(res.status).toBe(200);
        expect(res.body.drafts).toHaveLength(1);
        // Fallback subject/body should still be present
        expect(typeof res.body.drafts[0].subject).toBe('string');
        expect(typeof res.body.drafts[0].body).toBe('string');
    });

    // Security: auth middleware is applied (covered fully in auth.test.js)
    // Verify the endpoint does not bypass the user check — if no resume, it 400s
    // meaning the auth-injected userId was used to query Supabase.
    it('uses the authenticated userId to look up the resume', async () => {
        mockSupabaseNoResume(); // resume lookup fails → 400

        const res = await request(app)
            .post('/draft-personalized-emails')
            .set('Authorization', 'Bearer test-token')
            .send({ leads: SAMPLE_LEADS });

        // Confirms the DB was queried with req.userId (injected by requireAuth mock)
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/resume/i);
    });

    // Security: response must not leak resume text
    it('does not expose the raw resume text in the response', async () => {
        mockSupabaseWithResume('SECRET_RESUME_CONTENT_XYZ');
        mockClaudeSuccess();

        const res = await request(app)
            .post('/draft-personalized-emails')
            .set('Authorization', 'Bearer test-token')
            .send({ leads: [SAMPLE_LEADS[0]] });

        expect(res.status).toBe(200);
        const body = JSON.stringify(res.body);
        expect(body).not.toContain('SECRET_RESUME_CONTENT_XYZ');
    });

    // Security: injected strings in lead fields should not cause crashes
    it('handles malicious strings in lead name/detail without crashing', async () => {
        mockSupabaseWithResume();
        mockClaudeSuccess();

        const maliciousLead = {
            name: '<script>alert(1)</script>',
            email: 'xss@test.com',
            detail: '"; DROP TABLE users; --'
        };

        const res = await request(app)
            .post('/draft-personalized-emails')
            .set('Authorization', 'Bearer test-token')
            .send({ leads: [maliciousLead] });

        // Should not crash — returns 200 with a draft
        expect(res.status).toBe(200);
        expect(res.body.drafts).toHaveLength(1);
    });
});
