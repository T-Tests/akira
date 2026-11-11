import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MovieCard } from '../components/movie-card';
import { MovieTile } from '../components/movie-tile';
import type { MovieResult } from '../lib/types';

const movie: MovieResult = {
  id: 1, tmdb_id: 1, title: 'No values', release_year: null, runtime_min: null,
  poster_path: null, takeaway: null, advisory: null, recommended_min_age: null,
  value_slugs: null, providers: [], value_match_score: 0,
  original_language: null, origin_countries: [], is_black_and_white: false,
  subtitle_languages: [], audience: 'adults',
  violence: 0, scariness: 0, language: 0, sexual_content: 0, mature_themes: 0, lgbtq_themes: 0,
};

assert.match(renderToStaticMarkup(React.createElement(MovieCard, { m: movie })), /No values/);
assert.match(renderToStaticMarkup(React.createElement(MovieCard, { m: { ...movie, value_slugs: ['resilience'] } })), /Resilience/i);

// Point 1: Multiple country provider offers are deduplicated and country is not shown in detailed view
const multiCountryMovie: MovieResult = {
  ...movie,
  title: 'My Neighbor Totoro',
  providers: [
    { provider_id: 8, name: 'Netflix', type: 'flatrate', country: 'IN', link: null },
    { provider_id: 8, name: 'Netflix', type: 'flatrate', country: 'US', link: null },
    { provider_id: 8, name: 'Netflix', type: 'flatrate', country: 'GB', link: null },
  ],
};
const html = renderToStaticMarkup(React.createElement(MovieCard, { m: multiCountryMovie }));
// Netflix appears as a single badge and in the watch button
const netflixMatches = html.match(/Netflix/g);
assert.equal(netflixMatches?.length, 2); // 1 for Badge, 1 for "Watch on Netflix" button
// Country names should not appear in the badges or watch button
assert.doesNotMatch(html, /India/);
assert.doesNotMatch(html, /United States/);
assert.doesNotMatch(html, /United Kingdom/);

// Point 4: "Watch on" button takes the user directly to the respective OTT platform search for the movie
assert.match(html, /href="https:\/\/www\.netflix\.com\/search\?q=My%20Neighbor%20Totoro"/);
assert.doesNotMatch(html, /themoviedb\.org/);

// Point 1 in tile view: Only provider name is shown without country
const tileHtml = renderToStaticMarkup(React.createElement(MovieTile, { m: multiCountryMovie }));
assert.match(tileHtml, /Netflix/);
assert.doesNotMatch(tileHtml, /India/);
assert.doesNotMatch(tileHtml, /United States/);
assert.doesNotMatch(tileHtml, /United Kingdom/);

// Filter out buy/rent and deduplicate multiple providers to match normal tile/cards view
const noisyProvidersMovie: MovieResult = {
  ...movie,
  title: 'Inside Out',
  providers: [
    { provider_id: 10, name: 'Amazon Video', type: 'buy', country: 'AU', link: null },
    { provider_id: 2, name: 'Apple TV Store', type: 'buy', country: 'CA', link: null },
    { provider_id: 192, name: 'YouTube', type: 'buy', country: 'US', link: null },
    { provider_id: 337, name: 'Disney Plus', type: 'flatrate', country: 'US', link: null },
    { provider_id: 122, name: 'Disney+', type: 'flatrate', country: 'MY', link: null },
    { provider_id: 1986, name: 'NPO Plus', type: 'flatrate', country: 'NL', link: null },
    { provider_id: 117, name: 'Kinopoisk', type: 'flatrate', country: 'RU', link: null },
  ],
};
const noisyCardHtml = renderToStaticMarkup(React.createElement(MovieCard, { m: noisyProvidersMovie }));
// Buy/rent services should NOT appear as OTT badges
assert.doesNotMatch(noisyCardHtml, /Apple TV Store/);
assert.doesNotMatch(noisyCardHtml, /YouTube/);
// Disney+ should be canonicalized and shown cleanly
assert.match(noisyCardHtml, /Disney\+/);
// Should not flood with more than 2 badges
const tvBadges = noisyCardHtml.match(/lucide-tv/g);
assert.ok(tvBadges && tvBadges.length <= 2, `Expected at most 2 TV badges, got ${tvBadges?.length}`);
