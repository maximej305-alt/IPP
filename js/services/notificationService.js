export const notificationService = {
  isSupported(){ return "Notification" in window; },
  permission(){ return Notification.permission; },
  async request(){
    if(!this.isSupported()) throw new Error("Notifications non supportées");
    const p = await Notification.requestPermission();
    localStorage.setItem("ipp_notify", p);
    return p;
  },
  getPref(){ return localStorage.getItem("ipp_notify") || Notification.permission; },
  disable(){ localStorage.setItem("ipp_notify","denied"); },
  async simulate(title, body){
    if(Notification.permission==="granted") new Notification(title,{body});
  }
};
