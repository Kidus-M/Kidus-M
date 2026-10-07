// Pulls live numbers for the profile and writes data/live.json.
// Every source is optional: if one fails, its previous value is kept so the
// rendered SVGs never regress to empty or broken states.
import { readFile, writeFile } from 'node:fs/promises';

const FILE = new URL('../data/live.json', import.meta.url);
const CF_HANDLE = 'KidusMesfin';
const LC_USER = 'Kidus_Mesfin';
const GH_USER = 'Kidus-M';

const prev = JSON.parse(await readFile(FILE, 'utf8').catch(() => '{}'));
const next = structuredClone(prev);

async function getJson(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'user-agent': `${GH_USER}-profile-refresh`, ...init.headers },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function source(name, fn) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    console.warn(`kept  ${name} (${err.message})`);
  }
}

await source('codeforces', async () => {
  const [info, rating] = await Promise.all([
    getJson(`https://codeforces.com/api/user.info?handles=${CF_HANDLE}`),
    getJson(`https://codeforces.com/api/user.rating?handle=${CF_HANDLE}`),
  ]);
  const user = info.result?.[0];
  if (!user?.rating || !Array.isArray(rating.result)) throw new Error('unexpected shape');
  next.codeforces = {
    handle: CF_HANDLE,
    rating: user.rating,
    maxRating: user.maxRating,
    rank: user.rank,
    maxRank: user.maxRank,
    contests: rating.result.length,
    history: rating.result.map((c) => ({ t: c.ratingUpdateTimeSeconds, r: c.newRating })),
  };
});

await source('leetcode', async () => {
  const body = {
    query: `query($u: String!) {
      matchedUser(username: $u) { submitStats { acSubmissionNum { difficulty count } } }
      userContestRanking(username: $u) { rating attendedContestsCount }
    }`,
    variables: { u: LC_USER },
  };
  const { data } = await getJson('https://leetcode.com/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', referer: 'https://leetcode.com' },
    body: JSON.stringify(body),
  });
  const counts = Object.fromEntries(
    (data?.matchedUser?.submitStats?.acSubmissionNum ?? []).map((d) => [d.difficulty.toLowerCase(), d.count]),
  );
  if (!(counts.all > 0)) throw new Error('unexpected shape');
  next.leetcode = {
    user: LC_USER,
    total: counts.all,
    easy: counts.easy,
    medium: counts.medium,
    hard: counts.hard,
    contestRating: data.userContestRanking ? Math.round(data.userContestRanking.rating) : null,
  };
});

await source('github', async () => {
  const user = await getJson(`https://api.github.com/users/${GH_USER}`);
  if (typeof user.public_repos !== 'number') throw new Error('unexpected shape');
  next.github = { publicRepos: user.public_repos, since: Number(user.created_at.slice(0, 4)) };
});

await source('marucheck', async () => {
  const [pkg, repo] = await Promise.all([
    getJson('https://registry.npmjs.org/marucheck/latest'),
    getJson(`https://api.github.com/repos/${GH_USER}/MaruCheck`),
  ]);
  if (!pkg.version) throw new Error('unexpected shape');
  next.marucheck = { version: pkg.version, stars: repo.stargazers_count };
});

// Only touch the date when a number actually moved, so the workflow commits
// real changes instead of a daily timestamp bump.
const { updatedAt: _a, ...before } = prev;
const { updatedAt: _b, ...after } = next;
if (JSON.stringify(before) !== JSON.stringify(after)) {
  next.updatedAt = new Date().toISOString().slice(0, 10);
  await writeFile(FILE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`wrote data/live.json (${next.updatedAt})`);
} else {
  console.log('no changes');
}
