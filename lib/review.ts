import { supabase } from './discover';
import type { Audience, ReviewMovie } from './types';

export async function listReview(): Promise<ReviewMovie[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('list_review_movies', { p_limit: 50, p_offset: 0 });
  if (error) throw error;
  return data as ReviewMovie[];
}

export async function reviewMovie(tmdbId: number, audience: Audience): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase.rpc('review_movie', { p_tmdb_id: tmdbId, p_audience: audience });
  if (error) throw error;
  if (!data) throw new Error('This film was already reviewed.');
}
