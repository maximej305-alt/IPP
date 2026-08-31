export const AppConfig = {
  appName: "IPP — Institut Polytechnique LA PAIX",
  publicBase: "/public/",
  adminBase: "/admin/",
  version: "0.2.0-supabase-auth",
  // Supabase — Phase 6.4 : Auth réel, autres services encore mock (P16)
  supabase: {
    enabled: true,
    url: "https://kmboyqybbfeblzdkdtny.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttYm95cXliYmZlYmx6ZGtkdG55Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwMTM2MzIsImV4cCI6MjEwMzU4OTYzMn0.jzicZk4cGIQg9dssiVbdFl_ZLWJJ3ITGYb4bc9fp51U"
  },
  // useMock reste true pour news/events/results mock — seul auth passe en réel
  useMock: true
};

export const Levels = ["Seconde", "Première", "Terminale"];
export const Series = {
  "Seconde": ["A", "C", "F2", "F3"],
  "Première": ["A4", "C", "D", "F2", "F3"],
  "Terminale": ["A4", "C", "D", "F2", "F3"]
};
export const Sessions = ["Premier trimestre", "Deuxième trimestre", "Troisième trimestre", "Examen blanc"];
