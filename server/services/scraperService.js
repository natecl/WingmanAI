const crypto = require('crypto');

// Common university/org keyword → domain mapping (module-level for reuse)
const domainMap = {
    'uf': 'ufl.edu',
    'university of florida': 'ufl.edu',
    'mit': 'mit.edu',
    'stanford': 'stanford.edu',
    'harvard': 'harvard.edu',
    'berkeley': 'berkeley.edu',
    'uc berkeley': 'berkeley.edu',
    'ucla': 'ucla.edu',
    'georgia tech': 'gatech.edu',
    'carnegie mellon': 'cmu.edu',
    'cmu': 'cmu.edu',
    'columbia': 'columbia.edu',
    'yale': 'yale.edu',
    'princeton': 'princeton.edu',
    'cornell': 'cornell.edu',
    'nyu': 'nyu.edu',
    'umich': 'umich.edu',
    'university of michigan': 'umich.edu',
    'caltech': 'caltech.edu',
    'usf': 'usf.edu',
    'fsu': 'fsu.edu',
    'ucf': 'ucf.edu',
    'fiu': 'fiu.edu'
};

/**
 * Look up a domain from an organization/university name.
 * Returns { domain, matched } where matched=true if found in hardcoded map.
 */
function lookupDomain(org) {
    if (!org) return { domain: null, matched: false };
    const key = org.toLowerCase().trim();
    for (const [keyword, domainValue] of Object.entries(domainMap)) {
        if (key.includes(keyword) || keyword.includes(key)) {
            return { domain: domainValue, matched: true };
        }
    }
    return { domain: null, matched: false };
}

function shouldUseDomainLeadCache(searchMode) {
    return searchMode !== 'research';
}

/**
 * Normalize user prompt: lowercase, trim whitespace.
 * Extract a likely domain keyword from the prompt.
 * Accepts optional domainOverride to skip auto-detection.
 */
function normalizePrompt(prompt, domainOverride) {
    const normalized = prompt.toLowerCase().trim().replace(/\s+/g, ' ');

    if (domainOverride) {
        return { normalized, domain: domainOverride };
    }

    let domain = 'general';
    for (const [keyword, domainValue] of Object.entries(domainMap)) {
        if (normalized.includes(keyword)) {
            domain = domainValue;
            break;
        }
    }

    return { normalized, domain };
}

/**
 * Generate a SHA-256 cache key from domain and normalized prompt.
 */
function generateCacheKey(domain, normalizedPrompt) {
    const raw = `${domain}::${normalizedPrompt}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Check prompt_cache table for a fresh result (< 3 days old).
 * Returns array of email result objects or null.
 */
async function checkPromptCache(supabase, cacheKey) {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
        .from('prompt_cache')
        .select('result_emails')
        .eq('cache_key', cacheKey)
        .gte('created_at', threeDaysAgo)
        .single();

    if (error || !data) return null;
    return data.result_emails;
}

/**
 * Check email_leads table for existing contacts in the given domain.
 * Returns array of lead objects or null.
 */
async function checkEmailLeads(supabase, domain) {
    if (domain === 'general') return null;

    const { data, error } = await supabase
        .from('email_leads')
        .select('email, name, title, source_urls')
        .eq('domain', domain)
        .limit(50);

    if (error || !data || data.length === 0) return null;

    return data.map(lead => ({
        name: lead.name || 'Unknown',
        email: lead.email,
        detail: lead.title || '',
        sourceUrl: lead.source_urls?.[0] || ''
    }));
}

/**
 * Use Firecrawl's web search to find relevant URLs for the given prompt.
 * Returns array of URL strings from real search results.
 */
async function searchWithFirecrawl(firecrawl, prompt, domain, limit = 10) {
    const siteFilter = (domain && domain !== 'general') ? ` site:${domain}` : '';
    const searchQuery = `${prompt} email contact faculty directory${siteFilter}`;
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 10);
    const results = await firecrawl.search(searchQuery, { limit: safeLimit });
    if (!results.success || !results.data) return [];
    return results.data
        .map(r => r.url)
        .filter(u => typeof u === 'string' && u.startsWith('http'));
}

/**
 * Use Firecrawl to scrape each URL and extract contact information.
 * Returns array of { name, email, detail, sourceUrl }.
 */
async function scrapeEmails(firecrawl, urls) {
    if (!urls || urls.length === 0) return [];

    const results = [];
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

    for (const url of urls) {
        try {
            const scrapeResult = await firecrawl.scrapeUrl(url, {
                formats: ['markdown']
            });

            if (!scrapeResult.success || !scrapeResult.markdown) continue;

            const markdown = scrapeResult.markdown;

            // Deobfuscate common email obfuscation patterns before matching
            const deobfuscated = markdown
                .replace(/\s*\[at\]\s*/gi, '@')
                .replace(/\s*\(at\)\s*/gi, '@')
                .replace(/\s*\[dot\]\s*/gi, '.')
                .replace(/\s*\(dot\)\s*/gi, '.');

            const foundEmails = deobfuscated.match(emailRegex) || [];

            // Deduplicate emails from this page
            const uniqueEmails = [...new Set(foundEmails)];

            for (const email of uniqueEmails) {
                // Skip common non-personal emails
                if (/^(info|contact|admin|support|webmaster|noreply|no-reply)@/i.test(email)) continue;

                // Try to extract name context around the email
                const emailIndex = deobfuscated.indexOf(email);
                const surroundingText = deobfuscated.substring(
                    Math.max(0, emailIndex - 200),
                    Math.min(markdown.length, emailIndex + 200)
                );

                // Attempt to find a name (line before email or nearby bold text)
                let name = 'Unknown';
                const namePatterns = [
                    /\*\*([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\*\*/,
                    /#+\s*([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/,
                    /([A-Z][a-z]+ (?:[A-Z]\. )?[A-Z][a-z]+)(?:,|\s*\n|\s*-|\s*\|)/
                ];

                // Words that indicate a research area or department, not a person name
                const NOT_A_NAME = /\b(languages?|interfaces?|computing|systems?|sciences?|engineering|department|research|laboratory|networks?|intelligence|machine|learning|natural|language|processing|computer|vision|robotics|mathematics|physics|chemistry|biology|medicine|healthcare|artificial|neural|programming|software|hardware|databases?|algorithms?|theory|analysis|design|development|education|technology|applications?|security|cryptography|graphics|imaging|signals?|controls?|dynamics|structures?|materials?|management|economics|policy|ethics)\b/i;

                for (const pattern of namePatterns) {
                    const nameMatch = surroundingText.match(pattern);
                    if (nameMatch) {
                        const candidate = nameMatch[1].trim();
                        // Reject if it looks like a subject area rather than a person
                        if (!NOT_A_NAME.test(candidate)) {
                            name = candidate;
                            break;
                        }
                    }
                }

                // Try to extract a role/title
                let detail = '';
                const titlePatterns = [
                    /(?:Professor|Associate Professor|Assistant Professor|Lecturer|Director|Chair|Dean|Researcher|Postdoc|PhD)[^\n]*/i,
                    /(?:Department of|Dept\.? of)[^\n]*/i
                ];

                for (const pattern of titlePatterns) {
                    const titleMatch = surroundingText.match(pattern);
                    if (titleMatch) {
                        detail = titleMatch[0].trim().substring(0, 150);
                        break;
                    }
                }

                results.push({
                    name,
                    email,
                    detail,
                    sourceUrl: url
                });
            }
        } catch (err) {
            console.error(`Failed to scrape ${url}:`, err.message);
            // Continue with next URL
        }
    }

    // Deduplicate by email
    const seen = new Set();
    return results.filter(r => {
        if (seen.has(r.email)) return false;
        seen.add(r.email);
        return true;
    });
}

/**
 * Upsert scraped results into Supabase tables:
 * - scraped_pages: cache of what was scraped
 * - email_leads: directory of contacts
 * - prompt_cache: map prompt to results
 */
async function upsertResults(supabase, domain, normalizedPrompt, cacheKey, results, scrapedUrls) {
    // 1. Upsert scraped_pages
    for (const url of scrapedUrls) {
        const pageEmails = results.filter(r => r.sourceUrl === url);
        await supabase
            .from('scraped_pages')
            .upsert({
                url,
                domain,
                last_scraped_at: new Date().toISOString(),
                emails: pageEmails,
                text_snippet: `Scraped ${pageEmails.length} emails`
            }, { onConflict: 'url' });
    }

    // 2. Upsert email_leads
    for (const result of results) {
        await supabase
            .from('email_leads')
            .upsert({
                email: result.email,
                domain,
                name: result.name,
                title: result.detail,
                source_urls: [result.sourceUrl],
                last_seen_at: new Date().toISOString()
            }, { onConflict: 'email' });
    }

    // 3. Save to prompt_cache
    await supabase
        .from('prompt_cache')
        .upsert({
            cache_key: cacheKey,
            prompt: normalizedPrompt,
            domain,
            result_emails: results,
            created_at: new Date().toISOString()
        }, { onConflict: 'cache_key' });
}

module.exports = {
    normalizePrompt,
    generateCacheKey,
    checkPromptCache,
    checkEmailLeads,
    searchWithFirecrawl,
    scrapeEmails,
    upsertResults,
    lookupDomain,
    shouldUseDomainLeadCache
};
