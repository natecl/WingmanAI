function getFirecrawlApiKey(env = process.env) {
    return env.FIRECRAWL_API_KEY || env.Firecrawl_Api_Key || null;
}

function getMissingScrapeEnv(env = process.env) {
    const missing = [];

    if (!env.SUPABASE_URL) missing.push('SUPABASE_URL');
    if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
    if (!getFirecrawlApiKey(env)) missing.push('FIRECRAWL_API_KEY');

    return missing;
}

module.exports = {
    getFirecrawlApiKey,
    getMissingScrapeEnv
};
