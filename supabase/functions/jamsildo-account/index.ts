import { createHandler } from './handler.js';
const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
const publicKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
Deno.serve(createHandler({
  url: Deno.env.get('SUPABASE_URL')!,
  key: publicKeys.default || Deno.env.get('SUPABASE_ANON_KEY')!,
  serviceKey: secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
}));
