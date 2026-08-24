export default defineNuxtConfig({
  devtools: { enabled: false },
  css: ['~/assets/main.css'],
  runtimeConfig: {
    public: {
      supabaseUrl: 'https://bpuuqblxmxnelfwalevp.supabase.co',
      supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdXVxYmx4bXhuZWxmd2FsZXZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2MDYzMTksImV4cCI6MjEwMzE4MjMxOX0.Kd3_eZO2g_eOdCIXYiBlvZNP4IslhbI-LIl_QY2fAAA',
    },
  },
});
