// qa/anilist-probe.mjs - AniList GraphQL API shape probe (Phase 1 evidence). 2 requests, spaced.
import fs from 'node:fs/promises';
import path from 'node:path';
import { sleep } from './cdp.mjs';

const API = 'https://graphql.anilist.co';
const HEADERS = { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'Anigraph-QA/0.1 (harness probe)' };
const requests = [];

async function gql(label, query) {
  const response = await fetch(API, { method: 'POST', headers: HEADERS, body: JSON.stringify({ query }) });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  const record = {
    label,
    request: { query: query.replace(/\s+/g, ' ').trim() },
    response: {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: json ?? text,
    },
  };
  requests.push(record);
  console.log('# ' + label + ': HTTP ' + record.response.status + ' ' + (json?.errors ? json.errors.map((e) => e.status + ' ' + e.message).join('; ') : 'ok'));
  return record;
}

const STATS = 'statistics { anime { count meanScore episodesWatched minutesWatched } manga { count meanScore chaptersRead volumesRead } }';

// 1) Real public handles (all exist, so alias batching is safe). derF = AniList founder; Nepadeus = active user found in the public activity feed; iamkisei = zero-stat account for the empty state.
const publicUsers = await gql('public-users', 'query { derf: User(name: "derF") { id name createdAt ' + STATS + ' } nepadeus: User(name: "Nepadeus") { id name ' + STATS + ' } zero: User(name: "iamkisei") { id name ' + STATS + ' } }');
await sleep(1500);

// 2) Deliberately unknown user: exact public API failure shape.
const unknownName = 'qa_harness_no_such_user_83741';
const unknown = await gql('unknown-user', 'query { User(name: "' + unknownName + '") { id name ' + STATS + ' } }');

const artifact = {
  when: new Date().toISOString(),
  api: API,
  requestFormat: 'POST JSON { query } to https://graphql.anilist.co (no auth needed for public data)',
  publicUsers: publicUsers.response.body?.data ?? {},
  unknownUser: {
    name: unknownName,
    httpStatus: unknown.response.status,
    httpStatusMeaning: 'AniList returns HTTP 404 (not 200-with-errors) for a User that does not resolve.',
    body: unknown.response.body,
  },
  privateProfile: {
    liveSampleFound: false,
    conclusion: 'AniList private profiles are intentionally indistinguishable from unknown users to logged-out clients. Evidence: the public User schema exposes no privacy field (probed __type User/UserOptions), and AniList forum threads report private profiles 404 for everyone except the owner (thread 45319 "Please change private profiles showing as 404 page", thread 49536 "[Not a bug, private profile]"), with blocked profiles using the same 404 mechanism. No currently-private sample could be verified without guessing usernames (Uroskiler123, named as private in Dec 2021 forum evidence, is public again: id 5343974, anime 214 / manga 29).',
    recommendedMock: { httpStatus: 404, body: { errors: [{ message: 'Not Found.', status: 404 }], data: { User: null } } },
    uncertainAlternative: 'If a private profile ever resolves as a User object instead, statistics would likely be null; the app should also treat data.User.statistics == null as private.',
  },
  otherFindings: [
    'AniList GraphQL errors use HTTP 404 + errors[0].status 404 together; parse the JSON body instead of relying on response.ok alone.',
    'Alias-batched queries null ALL alias data when one alias 404s, so do not batch user lookups of unknown names.',
    'No rate-limit headers were returned in normal responses; 429/Retry-After behavior must be simulated (the harness Fetch mock covers it).',
    'CORS from a localhost http origin is verified separately in qa/artifacts/browser-cors-check.json.',
  ],
  requests,
};
const target = path.join(import.meta.dirname, 'artifacts', 'anilist-api-shapes.json');
await fs.mkdir(path.dirname(target), { recursive: true });
await fs.writeFile(target, JSON.stringify(artifact, null, 2));
console.log('# wrote ' + target);
