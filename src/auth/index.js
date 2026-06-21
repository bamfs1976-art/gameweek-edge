/* Bundled by esbuild into www/auth.js. Exposes the Supabase client
   factory on window so the (no-bundler) app can create a client. */
import { createClient } from '@supabase/supabase-js';
window.GE_SUPABASE = { createClient };
