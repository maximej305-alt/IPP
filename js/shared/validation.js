// validation.js — Validations frontend (P13)
// ⚠️  Validation frontend ≠ sécurité — toujours répéter côté backend/Supabase
export const Validation = {
  required(v){ return v !== null && v !== undefined && String(v).trim() !== ""; },
  minLength(v, n){ return String(v).trim().length >= n; },
  isLevel(v, levels){ return levels.includes(v); },
  isSerie(v, seriesMap, level){ return (seriesMap[level]||[]).includes(v); },
  fileExtension(name, allowed){ const ext = (name||"").toLowerCase().slice(name.lastIndexOf(".")); return allowed.includes(ext); },
  fileSize(file, maxMb){ return file.size <= maxMb*1024*1024; },
  dateNotPast(dateStr){ return new Date(dateStr) >= new Date(new Date().setHours(0,0,0,0)); }
};
