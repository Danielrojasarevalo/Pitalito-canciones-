export interface Song {
  id: number;
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  duration: number;
  explicit: boolean;
  source: 'local' | 'youtube';
  audio_url?: string;
  youtube_id?: string;
  cover_url?: string;
  color: string;
  is_blocked?: boolean;
  times_requested?: number;
  created_at?: string;
}

export interface QueueEntry {
  id: number;
  song: Song;
  table: string;
  dedication: string;
  is_background: boolean;
  requested_at: string;
  position: number | null;
  started_at?: string | null;
}

export interface RocolaState {
  current: QueueEntry | null;
  queue: QueueEntry[];
  is_paused: boolean;
  server_time: string;
}

export interface PublicBusiness {
  name: string;
  slug: string;
  city: string;
  accent_color: string;
  tables_count: number;
  allow_dedications: boolean;
  max_requests_per_table: number;
  requests_window_minutes: number;
  open: boolean;
  message: string;
}

export interface OwnerBusiness {
  id: number;
  name: string;
  slug: string;
  city: string;
  phone: string;
  accent_color: string;
  plan: string;
  monthly_price: number;
  is_active: boolean;
  subscription_until: string;
  subscription_ok: boolean;
  approval: 'pending' | 'approved' | 'rejected';
  player_token: string;
  background_playlist: number | null;
  tables_count: number;
  max_requests_per_table: number;
  requests_window_minutes: number;
  repeat_block_minutes: number;
  block_explicit: boolean;
  blocked_artists: string;
  requests_enabled: boolean;
  hours_start: string | null;
  hours_end: string | null;
  allow_dedications: boolean;
}

export interface Playlist {
  id: number;
  name: string;
  shuffle: boolean;
  song_ids: number[];
  songs_count: number;
  is_background: boolean;
}

export interface User {
  id: number;
  username: string;
  is_superuser: boolean;
  businesses: { id: number; name: string; slug: string }[];
}

export interface PlatformBusiness {
  id: number;
  name: string;
  slug: string;
  city: string;
  phone: string;
  plan: 'basico' | 'premium';
  monthly_price: number;
  is_active: boolean;
  subscription_until: string;
  subscription_ok: boolean;
  approval: 'pending' | 'approved' | 'rejected';
  owner_username: string;
  owner_email: string;
  songs_count: number;
  requests_30d: number;
  created_at: string;
}

export interface Payment {
  id: number;
  amount: number;
  months: number;
  method: string;
  reference: string;
  paid_at: string;
}
