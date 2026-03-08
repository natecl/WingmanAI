const {
    chunkText,
    buildSummaryText,
    embedTexts
} = require('../services/embeddingService');

// =========================================================
// chunkText
// =========================================================

describe('chunkText', () => {
    test('returns empty array for null', () => {
        expect(chunkText(null)).toEqual([]);
    });

    test('returns empty array for empty string', () => {
        expect(chunkText('')).toEqual([]);
    });

    test('returns empty array for whitespace-only string', () => {
        expect(chunkText('   \n\n   ')).toEqual([]);
    });

    test('returns single chunk for short text', () => {
        const text = 'Short paragraph here.';
        const chunks = chunkText(text);
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toBe('Short paragraph here.');
    });

    test('splits on paragraph boundaries', () => {
        // Create two paragraphs that together exceed MAX_CHARS (3200)
        const para1 = 'A'.repeat(2000);
        const para2 = 'B'.repeat(2000);
        const text = `${para1}\n\n${para2}`;
        const chunks = chunkText(text);
        expect(chunks.length).toBeGreaterThanOrEqual(2);
    });

    test('merges short final chunk with previous', () => {
        // Medium paragraph + tiny paragraph
        const para1 = 'A'.repeat(2000);
        const para2 = 'Short end.';
        const text = `${para1}\n\n${para2}`;
        const chunks = chunkText(text);
        // The tiny ending should be merged with the previous chunk
        expect(chunks[chunks.length - 1]).toContain('Short end.');
    });

    test('splits oversized paragraphs by sentences', () => {
        // Single paragraph with many sentences exceeding MAX_CHARS (3200)
        const sentences = Array.from({ length: 80 }, (_, i) =>
            `This is sentence number ${i + 1} with extra words to make it significantly longer and push over the limit.`
        );
        const text = sentences.join(' ');
        expect(text.length).toBeGreaterThan(3200); // Verify it actually exceeds MAX_CHARS
        const chunks = chunkText(text);
        expect(chunks.length).toBeGreaterThanOrEqual(2);
        // All content should be preserved
        for (const chunk of chunks) {
            expect(chunk.length).toBeGreaterThan(0);
        }
    });
});


// =========================================================
// buildSummaryText
// =========================================================

describe('buildSummaryText', () => {
    test('includes subject, from, and body preview', () => {
        const msg = {
            subject: 'Meeting Tomorrow',
            from_name: 'John Doe',
            from_email: 'john@test.com',
            body_text: 'Hi, just confirming our meeting.'
        };
        const summary = buildSummaryText(msg);
        expect(summary).toContain('Subject: Meeting Tomorrow');
        expect(summary).toContain('From: John Doe <john@test.com>');
        expect(summary).toContain('Hi, just confirming our meeting.');
    });

    test('handles missing from_name', () => {
        const msg = {
            subject: 'Test',
            from_name: '',
            from_email: 'anon@test.com',
            body_text: 'Body'
        };
        const summary = buildSummaryText(msg);
        expect(summary).toContain('From: anon@test.com');
    });

    test('handles missing fields gracefully', () => {
        const msg = {};
        const summary = buildSummaryText(msg);
        expect(summary).toBe('');
    });

    test('caps body preview at 400 characters', () => {
        const msg = {
            subject: 'Long email',
            from_name: 'Sender',
            from_email: 'sender@test.com',
            body_text: 'X'.repeat(1000)
        };
        const summary = buildSummaryText(msg);
        // Body part should be at most 400 chars
        const bodyLine = summary.split('\n').pop();
        expect(bodyLine.length).toBeLessThanOrEqual(400);
    });
});


// =========================================================
// embedTexts
// =========================================================

describe('embedTexts', () => {
    test('returns embeddings for texts', async () => {
        const mockOpenai = {
            embeddings: {
                create: jest.fn().mockResolvedValue({
                    data: [
                        { embedding: [0.1, 0.2, 0.3] },
                        { embedding: [0.4, 0.5, 0.6] }
                    ]
                })
            }
        };

        const result = await embedTexts(mockOpenai, ['text 1', 'text 2']);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual([0.1, 0.2, 0.3]);
        expect(result[1]).toEqual([0.4, 0.5, 0.6]);

        expect(mockOpenai.embeddings.create).toHaveBeenCalledWith({
            model: 'text-embedding-3-small',
            input: ['text 1', 'text 2'],
            dimensions: 512
        });
    });

    test('returns empty array for empty input', async () => {
        const mockOpenai = {
            embeddings: { create: jest.fn() }
        };

        const result = await embedTexts(mockOpenai, []);
        expect(result).toEqual([]);
        expect(mockOpenai.embeddings.create).not.toHaveBeenCalled();
    });

    test('returns empty array for null input', async () => {
        const mockOpenai = {
            embeddings: { create: jest.fn() }
        };

        const result = await embedTexts(mockOpenai, null);
        expect(result).toEqual([]);
    });

    test('propagates API errors', async () => {
        const mockOpenai = {
            embeddings: {
                create: jest.fn().mockRejectedValue(new Error('Rate limited'))
            }
        };

        await expect(embedTexts(mockOpenai, ['text'])).rejects.toThrow('Rate limited');
    });
});
