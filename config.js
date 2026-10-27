window.CONFIG = {
  title: "Relevo generacional",
  brandLine: "Future Leaders Forum · Fórum UPB",
  defaultLanguage: "pt",
  aspectRatio: 16 / 9,
  particleCount: 138,
  connectionDistance: 165,
  transitionSpeed: 0.055,
  assets: {
    ceremonyImage: "./assets/ceremonia-grados-placeholder.png",
    byMoment: {
      "auditorio-grados": {
        type: "image",
        src: "./assets/slide-02-grados.webp",
        alt: "Ceremonia de grados en Forum UPB",
        placement: "circle",
        anchor: "array-center",
        diameter: 0.36,
      },
      "nuevas-rutas": {
        type: "image",
        src: "./assets/slide-08-rutas.webp",
        alt: "Mesas de trabajo y conversaciones en comunidad",
        placement: "background",
      },
      "futuro-construido": {
        type: "image",
        src: "./assets/slide-12-futuro.webp",
        alt: "Auditorio Forum UPB preparado para un evento",
        placement: "background",
      },
      "qr-cierre": {
        type: "image",
        src: "./assets/slide-13-cierre.webp",
        alt: "Campus UPB al atardecer",
        placement: "background",
      },
    },
  },
  qr: {
    memoryUrl: "https://juanferfranco.github.io/ForumTEDTALK/",
    socialUrl: "https://www.instagram.com/centrodeeventosupb/",
    memoryImage: "./assets/qr-memory.png",
    socialImage: "./assets/qr-social.png",
    labels: {
      es: {
        memory: "Memorias",
        social: "@centrodeeventosupb",
      },
      pt: {
        memory: "Anais",
        social: "@centrodeeventosupb",
      },
    },
  },
  palette: {
    base: "#070808",
    ink: "#f7f7f4",
    eventCyan: "#08a9dd",
    eventRed: "#f7353f",
    eventMagenta: "#e96daa",
    eventBlack: "#222326",
    eventSilver: "#dde2e6",
    forumGold: "#d6a94f",
    uiViolet: "#8f7cff",
    uiBlue: "#4f8bff",
    uiPink: "#ff5fb8",
  },
};
