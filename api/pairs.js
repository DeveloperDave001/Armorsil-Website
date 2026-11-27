const OWNER = 'DeveloperDave001';
const REPO = 'Armorsil-Website';
const BRANCH = 'main';
const FILE_PATH = 'pairs.json';
const CONTENTS_URL = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function send(res, status, body) {
  Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

function normalize(value) {
  return String(value).toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

function validPair(pair) {
  return Array.isArray(pair)
    && pair.length === 2
    && pair.every((name) => typeof name === 'string' && normalize(name).length > 0)
    && normalize(pair[0]) !== normalize(pair[1]);
}

function pairExists(pairs, pair) {
  const names = pair.map(normalize);
  return pairs.some((existing) => existing.some((name) => names.includes(normalize(name))));
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'armorsil-gift-exchange',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

async function readPairs(headers) {
  const response = await fetch(`${CONTENTS_URL}?ref=${BRANCH}`, { headers });
  if (response.status === 404) return { pairs: [], sha: null };
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub read failed: ${response.status} ${detail}`);
  }

  const data = await response.json();
  let pairs = [];

  try {
    const parsed = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
    if (Array.isArray(parsed)) pairs = parsed.filter(validPair);
  } catch (error) {
    pairs = [];
  }

  return { pairs, sha: data.sha };
}

async function writePairs(pairs, sha, headers) {
  const body = {
    message: sha ? 'Update gift exchange pairs' : 'Create gift exchange pairs',
    branch: BRANCH,
    content: Buffer.from(`${JSON.stringify(pairs, null, 2)}\n`).toString('base64')
  };

  if (sha) body.sha = sha;

  return fetch(CONTENTS_URL, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
    res.status(204).end();
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) return send(res, 500, { error: 'GITHUB_TOKEN is not configured on Vercel.' });

  const headers = authHeaders(token);

  if (req.method === 'GET') {
    try {
      const { pairs } = await readPairs(headers);
      return send(res, 200, { pairs });
    } catch (error) {
      return send(res, 502, { error: error.message });
    }
  }

  if (req.method === 'POST') {
    const pair = req.body && req.body.pair;
    if (!validPair(pair)) return send(res, 400, { error: 'A valid pair with two different names is required.' });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const { pairs, sha } = await readPairs(headers);
        if (pairExists(pairs, pair)) return send(res, 409, { error: 'One of those names has already been paired.' });

        const updated = [...pairs, pair];
        const response = await writePairs(updated, sha, headers);
        if (response.ok) return send(res, 200, { pairs: updated });
        if (response.status === 409) continue;

        const detail = await response.text();
        return send(res, 502, { error: `GitHub write failed: ${response.status} ${detail}` });
      } catch (error) {
        return send(res, 502, { error: error.message });
      }
    }

    return send(res, 409, { error: 'Another draw happened at the same time. Please try again.' });
  }

  return send(res, 405, { error: 'Method not allowed.' });
};
