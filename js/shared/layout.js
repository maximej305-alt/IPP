// Shared helpers: mobile nav, active link, notifications + modern touches
export function initPublicLayout(){
  const toggle = document.querySelector("[data-nav-toggle]");
  const drawer = document.querySelector("[data-mobile-nav]");
  if(toggle && drawer){
    toggle.addEventListener("click", ()=> {
      const open = drawer.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
  }
  // active
  const path = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav__link, .mobile-nav__link").forEach(a=>{
    const href = a.getAttribute("href");
    if(href===path || (path==="" && href==="index.html")) a.classList.add("is-active");
  });
  // header scroll effect (moderne mais sobre)
  const header = document.querySelector(".site-header");
  if(header){
    const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive:true });
    onScroll();
  }
  // reveal on scroll — animation simple
  const revealEls = document.querySelectorAll(".section, .card, .timeline__item, .doc-item");
  revealEls.forEach(el => el.classList.add("reveal"));
  if("IntersectionObserver" in window){
    const io = new IntersectionObserver((entries)=>{
      entries.forEach(e=>{
        if(e.isIntersecting){ e.target.classList.add("is-visible"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    revealEls.forEach(el=> io.observe(el));
  } else {
    revealEls.forEach(el=> el.classList.add("is-visible"));
  }
  // hero already animated via CSS; ensure no FOUC
  document.documentElement.style.scrollBehavior = "smooth";
}

export function initNotifyBanner(){
  const banner = document.querySelector("[data-notify-banner]");
  if(!banner) return;
  const btnOn = banner.querySelector("[data-notify-on]");
  const btnOff = banner.querySelector("[data-notify-off]");
  const status = banner.querySelector("[data-notify-status]");
  function render(){
    const perm = Notification ? Notification.permission : "default";
    const pref = localStorage.getItem("ipp_notify");
    const enabled = perm==="granted" && pref!=="denied";
    status.textContent = enabled ? "Notifications activées" : "Notifications désactivées";
    if(btnOn) btnOn.style.display = enabled ? "none" : "inline-flex";
    if(btnOff) btnOff.style.display = enabled ? "inline-flex" : "none";
  }
  btnOn?.addEventListener("click", async ()=>{
    try{ await Notification.requestPermission(); localStorage.setItem("ipp_notify", Notification.permission); render(); }catch{}
  });
  btnOff?.addEventListener("click", ()=>{ localStorage.setItem("ipp_notify","denied"); render(); });
  render();
}
