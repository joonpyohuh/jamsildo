import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const { SUPABASE_URL } = loadEnv(mode, '.', 'SUPABASE_');
  return {
    server: SUPABASE_URL ? { proxy: { '/api/account': {
      target: SUPABASE_URL, changeOrigin: true,
      rewrite: () => '/functions/v1/jamsildo-account',
    } } } : undefined,
  };
});
