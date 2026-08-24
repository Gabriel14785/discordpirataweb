export default defineNuxtConfig({
  devtools: { enabled: false },
  css: ['~/assets/main.css'],
  runtimeConfig: {
    public: {
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL || 'https://bpuuqblxmxnelfwalevp.supabase.co',
      supabaseAnonKey: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdXVxYmx4bXhuZWxmd2FsZXZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2MDYzMTksImV4cCI6MjEwMzE4MjMxOX0.Kd3_eZO2g_eOdCIXYiBlvZNP4IslhbI-LIl_QY2fAAA',
    },
  },
});
