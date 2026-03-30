describe('client research finder helpers', () => {
    let helpers;

    beforeEach(() => {
        jest.resetModules();
        helpers = require('../../../client/js/content-leads.js');
    });

    test('buildResearchSearchPrompt creates a professor-focused university query', () => {
        expect(
            helpers.buildResearchSearchPrompt('computer vision', 'University of Florida')
        ).toBe('computer vision professors faculty research lab at University of Florida');
    });

    test('buildResearchEmailPurpose centers the email on student research outreach', () => {
        const purpose = helpers.buildResearchEmailPurpose('robotics', 'MIT');

        expect(purpose).toContain('student');
        expect(purpose).toContain('robotics');
        expect(purpose).toContain('MIT');
        expect(purpose).toContain('research opportunities');
    });

    test('rankResearchMatches prioritizes professor-like academic contacts', () => {
        const ranked = helpers.rankResearchMatches([
            {
                name: 'Startup Founder',
                email: 'founder@company.com',
                detail: 'Founder',
                sourceUrl: 'https://company.com/team'
            },
            {
                name: 'Dr. Ada Lovelace',
                email: 'ada@ufl.edu',
                detail: 'Associate Professor of Computer Science',
                sourceUrl: 'https://cise.ufl.edu/faculty/ada'
            }
        ]);

        expect(ranked[0].email).toBe('ada@ufl.edu');
    });
});
