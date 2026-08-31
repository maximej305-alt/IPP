const mockGallery = [
  { id:"g1", year:"2026", album:"Semaine technique", count:12, cover:"placeholder" },
  { id:"g2", year:"2026", album:"Activités sportives", count:8, cover:"placeholder" },
  { id:"g3", year:"2026", album:"Journée culturelle", count:15, cover:"placeholder" },
];
export const galleryService = {
  async list(){ await new Promise(r=>setTimeout(r,80)); return mockGallery; },
  async grouped(){
    const map={};
    mockGallery.forEach(g=>{ if(!map[g.year]) map[g.year]=[]; map[g.year].push(g); });
    return map;
  }
};
