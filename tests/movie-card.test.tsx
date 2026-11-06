import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MovieCard } from '../components/movie-card';
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
