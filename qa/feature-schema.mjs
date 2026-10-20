const query = `query FeatureProbe {
  GenreCollection
  Page(page: 1, perPage: 2) {
    pageInfo { hasNextPage }
    media(type: ANIME, season: FALL, seasonYear: 2026, isAdult: false, averageScore_greater: 69, sort: POPULARITY_DESC) {
      id type title { romaji } genres format averageScore coverImage { large } startDate { year }
    }
  }
  seeds: Page(page: 1, perPage: 1) {
    media(id_in: [5114], type: ANIME) {
      id recommendations(perPage: 3, sort: RATING_DESC) {
        nodes { rating mediaRecommendation { id type isAdult title { romaji } genres format averageScore coverImage { large } startDate { year } } }
      }
    }
  }
}`;
const response = await fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
const result = await response.json();
console.log(JSON.stringify({ status: response.status, errors: result.errors, genres: result.data?.GenreCollection?.length, seasonal: result.data?.Page?.media?.map(e=>e.title.romaji), recommendations: result.data?.seeds?.media?.[0]?.recommendations?.nodes?.map(e=>e.mediaRecommendation?.title?.romaji) }, null, 2));
if (!response.ok || result.errors) process.exitCode = 1;
