const TAU = Math.PI * 2;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
const quadraticPoint = (a, control, b, t) => lerp(lerp(a, control, t), lerp(control, b, t), t);

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const n = parseInt(clean, 16);
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
  };
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function makeHash(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function seededUnit(seed) {
  const x = Math.sin(seed * 999.91) * 10000;
  return x - Math.floor(x);
}

class VisualSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.time = 0;
    this.momentTime = 0;
    this.current = null;
    this.target = null;
    this.params = {
      spiral: 0.25,
      network: 0.2,
      architecture: 0.2,
      archive: 0,
      stability: 0.2,
      intensity: 0.4,
    };
    this.colors = ["#ffb43b", "#46ead2", "#f6f1e8"];
    this.particles = Array.from({ length: CONFIG.particleCount }, (_, i) => ({
      seed: i + 1,
      x: seededUnit(i + 4),
      y: seededUnit(i + 18),
      px: 0,
      py: 0,
      size: 1 + seededUnit(i + 54) * 2.2,
      lane: i % 3,
      drift: seededUnit(i + 88) * TAU,
    }));

    // Relevo generacional: dos generaciones que comparten las mismas 138 partículas
    // a lo largo de todas las diapositivas (antigua = roja, nueva = azul).
    this.oldCount = Math.round(CONFIG.particleCount * 0.68);
    this.particles.forEach((p, i) => {
      p.generation = i < this.oldCount ? "old" : "new";
      p.buildOrder = i < this.oldCount ? i : i - this.oldCount;
    });

    // --- Slide 1 "genesis": castillo construido por la generación antigua,
    // rematado por la nueva. ---
    this.genesisTiming = {
      oldFastEnd: 3.4,
      oldSlowEnd: 42,
      newArriveStart: 9,
      newArriveSpan: 8,
      newEachDuration: 3,
    };
    this.buildCastleBlueprint();

    // --- Slide 2 "ingreso": la generación nueva se forma en un arreglo
    // cuadrado entrando horizontalmente fila por fila; luego, de a una,
    // las partículas salen, recorren una fila exterior y vuelven a entrar
    // por el lado opuesto, siempre en movimiento horizontal. ---
    this.ingresoTiming = {
      formDuration: 5.6, // ventana en la que se arma la figura completa
      formRowStagger: 0.5, // retraso entre el inicio de cada fila al formarse
      formSlide: 1.8, // duración del deslizamiento de cada fila al formarse
      transitionDuration: 1.0, // duración de cada salida/entrada individual
      restDuration: 1.6, // tiempo recorriendo la fila exterior
      cycleGap: 1.1, // desfase entre el ciclo de una partícula y la siguiente
    };
    this.buildIngresoGrid();

    // --- Slide 3 "telarana": la Universidad (núcleo central) se conecta con
    // el mundo (varios mini cúmulos). Las partículas jóvenes salen del
    // centro, se pegan a cada cúmulo tejiendo una red, y finalmente esos
    // cúmulos son halados de vuelta hacia el centro. ---
    this.buildRedNetwork();

    // --- Slides 4 & 5 "triad" y "impact": 3 grupos con forma cuadrada,
    // triangular y circular. En el slide 4 están incompletas y se halan de vez
    // en cuando entre sí pero siempre conectadas. En el slide 5 llega un nuevo
    // cúmulo desde fuera de la vista hacia el centro, se reúne, se dispersa
    // entre los 3 grupos y los completa. ---
    this.buildTriadShapes();

    // Foto circular de borde desvanecido que puede ubicarse en distintos
    // puntos del mapa según la diapositiva.
    this.photoConfig = null;
    this.photoSrc = null;
    this.photoImg = null;
    this.photoBuffer = null;
    this.photoBufferCtx = null;

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  // === Slide 1: plano del castillo (espacio normalizado 0..1, y=1 es el suelo) ===
  isOldCastleMask(x, y) {
    const inLeftTower = x >= 0.06 && x <= 0.22 && y >= 0.4 && y < 0.94;
    const inRightTower = x >= 0.78 && x <= 0.94 && y >= 0.4 && y < 0.94;
    const inKeep = x >= 0.41 && x <= 0.59 && y >= 0.22 && y < 0.94;
    const inLeftWall = x >= 0.22 && x < 0.41 && y >= 0.58 && y < 0.94;
    const inRightWall = x > 0.59 && x <= 0.78 && y >= 0.58 && y < 0.94;
    const inGate = x >= 0.46 && x <= 0.54 && y >= 0.74 && y < 0.94;
    if (inGate) return false;
    return inLeftTower || inRightTower || inKeep || inLeftWall || inRightWall;
  }

  isNewCastleMask(x, y) {
    const tooth = (localX, width) => Math.floor(localX / width) % 2 === 0;
    if (x >= 0.06 && x <= 0.22 && y >= 0.35 && y < 0.4) return tooth(x - 0.06, 0.04);
    if (x >= 0.78 && x <= 0.94 && y >= 0.35 && y < 0.4) return tooth(x - 0.78, 0.04);
    if (x >= 0.41 && x <= 0.59 && y >= 0.16 && y < 0.22) return tooth(x - 0.41, 0.036);
    if (x >= 0.22 && x < 0.41 && y >= 0.52 && y < 0.58) return tooth(x - 0.22, 0.038);
    if (x > 0.59 && x <= 0.78 && y >= 0.52 && y < 0.58) return tooth(x - 0.59, 0.038);
    if (x >= 0.494 && x <= 0.506 && y >= 0.05 && y < 0.16) return true;
    if (x >= 0.5 && x <= 0.585 && y >= 0.05 && y < 0.095) return true;
    return false;
  }

  decimate(cells, count) {
    if (count <= 0 || cells.length === 0) return [];
    const ratio = count / cells.length;
    const result = [];
    let credit = 0;
    for (const cell of cells) {
      credit += ratio;
      if (credit >= 1) {
        result.push(cell);
        credit -= 1;
        if (result.length >= count) break;
      }
    }
    let i = 0;
    while (result.length < count) {
      result.push(cells[i % cells.length]);
      i += 1;
    }
    return result;
  }

  // Muestrea una máscara con una grilla cuadrada creciente hasta reunir al menos
  // `desiredCount` puntos, y recién entonces recorta el sobrante. Al mantener el
  // sobrante pequeño, el recorte no introduce sesgos (evita franjas diagonales).
  sampleMaskEven(maskFn, desiredCount) {
    let res = 6;
    let pts = [];
    while (pts.length < desiredCount && res < 400) {
      pts = [];
      for (let iy = 0; iy < res; iy += 1) {
        const y = (iy + 0.5) / res;
        for (let ix = 0; ix < res; ix += 1) {
          const x = (ix + 0.5) / res;
          if (maskFn(x, y)) pts.push({ x, y });
        }
      }
      res += 2;
    }
    return this.decimate(pts, desiredCount);
  }

  buildCastleBlueprint() {
    const newCount = this.particles.length - this.oldCount;
    const oldPoints = this.sampleMaskEven((x, y) => this.isOldCastleMask(x, y), this.oldCount).sort(
      (a, b) => b.y - a.y,
    );
    const newPoints = this.sampleMaskEven((x, y) => this.isNewCastleMask(x, y), newCount).sort(
      (a, b) => b.y - a.y,
    );
    for (let i = 0; i < this.particles.length; i += 1) {
      const p = this.particles[i];
      p.castle = p.generation === "old" ? oldPoints[p.buildOrder] : newPoints[p.buildOrder];
    }
  }

  castleLocalToCanvas(nx, ny) {
    const base = Math.min(this.width, this.height);
    const cx = this.width * 0.6;
    const groundY = this.height * 0.84;
    const castleW = base * 0.86;
    const castleH = base * 0.74;
    const originX = cx - castleW / 2;
    const originY = groundY - castleH;
    return { x: originX + nx * castleW, y: originY + ny * castleH };
  }

  // === Slide 2: arreglo cuadrado de ingreso ===
  buildIngresoGrid() {
    const newCount = this.particles.length - this.oldCount;
    const cols = Math.max(1, Math.round(Math.sqrt(newCount)));
    const rows = Math.ceil(newCount / cols);
    const slots = [];
    for (let r = 0; r < rows; r += 1) {
      const itemsInRow = Math.min(cols, newCount - r * cols);
      const rowOffset = (cols - itemsInRow) / 2;
      // Cada fila es un carril horizontal de un solo sentido: entra por un
      // lado y sale por el opuesto, alternando entre filas para variedad.
      const exitSide = r % 2 === 0 ? "right" : "left";
      const entrySide = exitSide === "right" ? "left" : "right";
      for (let c = 0; c < itemsInRow; c += 1) {
        const colPos = c + rowOffset;
        slots.push({ x: (colPos + 0.5) / cols, y: (r + 0.5) / rows, row: r, exitSide, entrySide });
      }
    }
    this.ingresoCols = cols;
    this.ingresoRows = rows;
    for (let i = this.oldCount; i < this.particles.length; i += 1) {
      const p = this.particles[i];
      p.ingresoSlot = slots[p.buildOrder];
    }
  }

  ingresoLocalToCanvas(nx, ny) {
    const base = Math.min(this.width, this.height);
    const arrayW = base * 0.46;
    const arrayH = base * 0.4;
    const cx = this.width * 0.5;
    const cy = this.height * 0.48;
    const originX = cx - arrayW / 2;
    const originY = cy - arrayH / 2;
    return { x: originX + nx * arrayW, y: originY + ny * arrayH };
  }

  getArrayCenter() {
    return this.ingresoLocalToCanvas(0.5, 0.5);
  }

  // Puntos de la "fila exterior": justo afuera del cuadro a cada lado de la
  // fila, y un punto de control para arquear el tramo que las une por fuera
  // del arreglo (arriba si la fila está en la mitad superior, abajo si no).
  getIngresoStage(slot) {
    const base = Math.min(this.width, this.height);
    const home = this.ingresoLocalToCanvas(slot.x, slot.y);
    const exitLocalX = slot.exitSide === "right" ? 1.14 : -0.14;
    const entryLocalX = slot.entrySide === "right" ? 1.14 : -0.14;
    const queueOut = this.ingresoLocalToCanvas(exitLocalX, slot.y);
    const queueIn = this.ingresoLocalToCanvas(entryLocalX, slot.y);
    const verticalDir = slot.row % 2 === 0 ? -1 : 1;
    const arcControlX = (queueOut.x + queueIn.x) / 2;
    const arcControlY = home.y + verticalDir * base * 0.2;
    return { home, queueOut, queueIn, arcControlX, arcControlY };
  }

  // === Slide 3: red de telaraña Universidad-mundo ===
  buildRedNetwork() {
    const clusterCount = 6;
    this.redClusterCount = clusterCount;
    this.redClusters = [];
    for (let i = 0; i < clusterCount; i += 1) {
      const angle = (i / clusterCount) * TAU + (seededUnit(i * 17 + 3) - 0.5) * 0.32;
      const radiusFrac = 0.3 + seededUnit(i * 29 + 7) * 0.14;
      this.redClusters.push({ angle, radiusFrac });
    }

    // Una pequeña semilla por cúmulo (mini cúmulos ya presentes cerca del
    // centro) y el resto de la generación antigua conforma el núcleo denso
    // que representa a la Universidad.
    const seedsPerCluster = 3;
    let oldIndex = 0;
    for (let c = 0; c < clusterCount; c += 1) {
      for (let s = 0; s < seedsPerCluster; s += 1) {
        const p = this.particles[oldIndex];
        p.redRole = "seed";
        p.redCluster = c;
        p.redSeedIndex = s;
        oldIndex += 1;
      }
    }
    for (; oldIndex < this.oldCount; oldIndex += 1) {
      const p = this.particles[oldIndex];
      p.redRole = "core";
      p.redCluster = null;
    }

    // Las partículas jóvenes se reparten entre los cúmulos (round-robin) y
    // salen del centro una por una, en orden entrelazado entre cúmulos, para
    // que el tejido de la red se vea progresivo y no en oleadas.
    const newCount = this.particles.length - this.oldCount;
    for (let i = 0; i < newCount; i += 1) {
      const p = this.particles[this.oldCount + i];
      p.redRole = "web";
      p.redCluster = i % clusterCount;
      p.redDepartureIndex = i;
      p.redAttach = 0;
    }

    this.telaranaTiming = {
      formDuration: 3.4, // la Universidad y los cúmulos toman su lugar
      webStagger: 0.26, // separación entre la salida de una partícula joven y la siguiente
      webTravel: 1.5, // duración del viaje de cada partícula hasta pegarse a su cúmulo
      holdAfterWeb: 2.2, // pausa con la red completamente tejida
      pullDuration: 5, // duración de halar los cúmulos hacia el centro
    };
    this.telaranaWebDuration = (newCount - 1) * this.telaranaTiming.webStagger + this.telaranaTiming.webTravel;
  }

  redCenter() {
    return { x: this.width * 0.6, y: this.height * 0.46 };
  }

  redClusterAnchor(clusterIndex, pull = 0) {
    const cluster = this.redClusters[clusterIndex];
    const base = Math.min(this.width, this.height);
    const center = this.redCenter();
    const radius = base * cluster.radiusFrac * (1 - pull);
    return {
      x: center.x + Math.cos(cluster.angle) * radius,
      y: center.y + Math.sin(cluster.angle) * radius * 0.6,
    };
  }

  // 0 = cúmulos en su posición original; 1 = ya halados hasta el centro.
  getTelaranaPull() {
    const timing = this.telaranaTiming;
    const pullStart = timing.formDuration + this.telaranaWebDuration + timing.holdAfterWeb;
    const pullEnd = pullStart + timing.pullDuration;
    return smoothstep(pullStart, pullEnd, this.momentTime);
  }

  // === Slides 4 & 5: Tres grupos (Cuadrado, Triángulo, Círculo) ===
  buildTriadShapes() {
    // 3 figuras: 0 = Cuadrado (Academia), 1 = Triángulo (Industria), 2 = Círculo (Ciudad).
    // Las 94 partículas base (antigua generación) forman las 3 figuras incompletas en el slide 4.
    // Las 44 partículas de refuerzo (nueva generación) llegan en el slide 5 desde fuera de la
    // vista hacia el centro, se reúnen, se dispersan y completan las 3 figuras (46 partículas c/u).

    // 1. Cuadrado (Grupo 0): 31 base + 15 completers = 46 puntos.
    // En slide 4 faltan los 15 puntos del lado derecho (lado que mira al centro).
    const squareBase = [];
    // Lado superior: 11 puntos (perimeterOrder 0..10)
    for (let i = 0; i <= 10; i += 1) {
      squareBase.push({ lx: -1.0 + (2.0 * i) / 10, ly: -1.0, perimeterOrder: i });
    }
    // Lado inferior: 10 puntos (perimeterOrder 26..35)
    for (let i = 0; i < 10; i += 1) {
      const t = i / 9;
      squareBase.push({ lx: 1.0 - 2.0 * t, ly: 1.0, perimeterOrder: 26 + i });
    }
    // Lado izquierdo: 10 puntos (perimeterOrder 36..45)
    for (let i = 0; i < 10; i += 1) {
      const t = i / 9;
      squareBase.push({ lx: -1.0, ly: 1.0 - 2.0 * t, perimeterOrder: 36 + i });
    }
    // Lado derecho (incompleto en slide 4, completado en slide 5): 15 puntos (perimeterOrder 11..25)
    const squareCompleters = [];
    for (let k = 0; k < 15; k += 1) {
      const t = (k + 0.5) / 15;
      squareCompleters.push({ lx: 1.0, ly: -1.0 + 2.0 * t, perimeterOrder: 11 + k });
    }

    // 2. Triángulo (Grupo 1): 31 base + 15 completers = 46 puntos.
    // Vértice superior en (0, -1.15), base de (-1.05, 0.75) a (1.05, 0.75).
    // En slide 4 falta la base inferior (lado que mira al centro).
    const triangleBase = [];
    // Lado izquierdo: 16 puntos (perimeterOrder 0..15, desde vértice a esquina inferior izquierda)
    for (let i = 0; i <= 15; i += 1) {
      const t = i / 15;
      triangleBase.push({ lx: lerp(0, -1.05, t), ly: lerp(-1.15, 0.75, t), perimeterOrder: i });
    }
    // Lado derecho: 15 puntos (perimeterOrder 31..45, desde esquina inferior derecha hacia el vértice)
    for (let i = 0; i < 15; i += 1) {
      const t = i / 14;
      triangleBase.push({ lx: lerp(1.05, 0, t), ly: lerp(0.75, -1.15, t), perimeterOrder: 31 + i });
    }
    // Base inferior (incompleta en slide 4, completada en slide 5): 15 puntos (perimeterOrder 16..30)
    const triangleCompleters = [];
    for (let k = 0; k < 15; k += 1) {
      const t = (k + 0.5) / 15;
      triangleCompleters.push({ lx: lerp(-1.05, 1.05, t), ly: 0.75, perimeterOrder: 16 + k });
    }

    // 3. Círculo (Grupo 2): 32 base + 14 completers = 46 puntos.
    // En slide 4 falta el arco que mira hacia el centro (de 0.7*PI a 1.36*PI, ~119°).
    const circleBase = [];
    const startArc = 1.36 * Math.PI;
    const arcSpan = 1.34 * Math.PI;
    for (let i = 0; i < 32; i += 1) {
      const angle = startArc + (i / 31) * arcSpan;
      circleBase.push({ lx: Math.cos(angle), ly: Math.sin(angle), perimeterOrder: i });
    }
    // Arco faltante (completado en slide 5): 14 puntos (perimeterOrder 32..45, de 0.7*PI a 1.36*PI)
    const circleCompleters = [];
    const gapStart = 0.7 * Math.PI;
    const gapSpan = startArc - gapStart;
    for (let k = 0; k < 14; k += 1) {
      const angle = gapStart + ((k + 0.5) / 14) * gapSpan;
      circleCompleters.push({ lx: Math.cos(angle), ly: Math.sin(angle), perimeterOrder: 32 + k });
    }

    // Asignación de roles a las 138 partículas
    for (let i = 0; i < this.particles.length; i += 1) {
      const p = this.particles[i];
      if (i < this.oldCount) {
        p.isCompleter = false;
        if (i < 31) {
          p.triadGroup = 0; // Cuadrado
          p.triadLocal = squareBase[i];
          p.perimeterOrder = squareBase[i].perimeterOrder;
        } else if (i < 62) {
          p.triadGroup = 1; // Triángulo
          p.triadLocal = triangleBase[i - 31];
          p.perimeterOrder = triangleBase[i - 31].perimeterOrder;
        } else {
          p.triadGroup = 2; // Círculo
          p.triadLocal = circleBase[i - 62];
          p.perimeterOrder = circleBase[i - 62].perimeterOrder;
        }
      } else {
        p.isCompleter = true;
        const k = i - this.oldCount; // 0..43
        p.completerOrder = k;
        p.offscreenAngle = (k / 44) * TAU + (seededUnit(p.seed * 37 + 5) - 0.5) * 0.45;
        p.offscreenDistFactor = 1.3 + seededUnit(p.seed * 19 + 11) * 0.45;

        if (k < 15) {
          p.triadGroup = 0;
          p.triadLocal = squareCompleters[k];
          p.perimeterOrder = squareCompleters[k].perimeterOrder;
        } else if (k < 30) {
          const idx = k - 15;
          p.triadGroup = 1;
          p.triadLocal = triangleCompleters[idx];
          p.perimeterOrder = triangleCompleters[idx].perimeterOrder;
        } else {
          const idx = k - 30;
          p.triadGroup = 2;
          p.triadLocal = circleCompleters[idx];
          p.perimeterOrder = circleCompleters[idx].perimeterOrder;
        }
      }
    }

    this.triadSlide5Timing = {
      streamStagger: 0.036,
      arriveTravel: 1.5,
      gatherHold: 1.4,
      disperseTravel: 1.5,
    };
  }

  getTriadCenter() {
    return { x: this.width * 0.62, y: this.height * 0.48 };
  }

  getTriadAnchors(time) {
    const base = Math.min(this.width, this.height);
    const center = this.getTriadCenter();
    const triadDist = base * 0.28;

    // Posiciones base de los 3 grupos
    const anchors = [
      { x: center.x - triadDist * 0.95, y: center.y + triadDist * 0.62 }, // 0: Cuadrado
      { x: center.x, y: center.y - triadDist * 0.92 }, // 1: Triángulo
      { x: center.x + triadDist * 0.95, y: center.y + triadDist * 0.62 }, // 2: Círculo
    ];

    // "se halan de vez en cuando entre sí pero siempre conectadas":
    // Ciclo periódico con eventos alternados donde pares de grupos se halan elásticamente.
    const cycleDur = 6.6;
    const tCycle = (time >= 0 ? time : 0) % cycleDur;
    const events = [
      { pair: [0, 1], start: 0.2, dur: 1.7 },
      { pair: [1, 2], start: 2.3, dur: 1.7 },
      { pair: [2, 0], start: 4.4, dur: 1.7 },
    ];

    this.triadPull = { pair: null, tension: 0 };
    for (const ev of events) {
      if (tCycle >= ev.start && tCycle < ev.start + ev.dur) {
        const subT = (tCycle - ev.start) / ev.dur;
        const envelope = Math.sin(subT * Math.PI);
        const tension = Math.pow(envelope, 1.4);
        const pullDist = base * 0.048 * tension;

        const a = anchors[ev.pair[0]];
        const b = anchors[ev.pair[1]];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1;
        const ux = dx / dist;
        const uy = dy / dist;

        a.x += ux * pullDist;
        a.y += uy * pullDist;
        b.x -= ux * pullDist;
        b.y -= uy * pullDist;

        this.triadPull = { pair: ev.pair, tension };
        break;
      }
    }

    return anchors;
  }

  drawTriadAmbient(ctx, isImpact) {
    const base = Math.min(this.width, this.height);
    const center = this.getTriadCenter();
    const anchors = this.getTriadAnchors(this.time);
    const groupColors = [CONFIG.palette.eventCyan, CONFIG.palette.eventRed, CONFIG.palette.eventMagenta];

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // Resplandor en cada uno de los 3 grupos
    for (let i = 0; i < 3; i += 1) {
      const a = anchors[i];
      const r = base * 0.16;
      const glow = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, r);
      glow.addColorStop(0, rgba(groupColors[i], 0.13 + this.params.intensity * 0.05));
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(a.x - r, a.y - r, r * 2, r * 2);
    }

    // En slide 5: núcleo de luz en el centro mientras las partículas se reúnen
    if (isImpact) {
      const gatherGlowAlpha = smoothstep(0.3, 1.6, this.momentTime) * (1 - smoothstep(3.5, 5.0, this.momentTime));
      if (gatherGlowAlpha > 0.01) {
        const r = base * (0.12 + Math.sin(this.time * 3.5) * 0.02);
        const centerGlow = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, r);
        centerGlow.addColorStop(0, rgba(CONFIG.palette.forumGold, 0.28 * gatherGlowAlpha));
        centerGlow.addColorStop(0.5, rgba(CONFIG.palette.eventCyan, 0.14 * gatherGlowAlpha));
        centerGlow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = centerGlow;
        ctx.fillRect(center.x - r, center.y - r, r * 2, r * 2);
      }

      // Al completarse (a partir de ~5.3s), onda de resonancia e impacto armónico
      if (this.momentTime > 5.3) {
        const completionTime = this.momentTime - 5.3;
        const waveProgress = Math.min(1, completionTime / 2.5);
        for (let i = 0; i < 3; i += 1) {
          const a = anchors[i];
          const waveR = base * (0.05 + waveProgress * 0.18);
          const waveAlpha = (1 - waveProgress) * 0.22;
          ctx.strokeStyle = rgba(groupColors[i], waveAlpha);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(a.x, a.y, waveR, 0, TAU);
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }

  drawTriadConnections(ctx, isImpact) {
    const base = Math.min(this.width, this.height);
    const center = this.getTriadCenter();
    const groupColors = [CONFIG.palette.eventCyan, CONFIG.palette.eventRed, CONFIG.palette.eventMagenta];

    ctx.save();
    ctx.lineCap = "round";

    // 1. Conexiones perimetrales dentro de cada figura (para que el contorno sea claramente visible)
    const groups = [[], [], []];
    for (const p of this.particles) {
      if (p.triadGroup !== undefined && p.triadAlpha > 0.2 && p.isJoined) {
        groups[p.triadGroup].push(p);
      }
    }

    for (let g = 0; g < 3; g += 1) {
      const pts = groups[g].sort((a, b) => a.perimeterOrder - b.perimeterOrder);
      const col = groupColors[g];

      for (let i = 0; i < pts.length; i += 1) {
        const a = pts[i];
        for (let j = i + 1; j < pts.length; j += 1) {
          const b = pts[j];
          const diff = Math.abs(a.perimeterOrder - b.perimeterOrder);
          const isNeighbor = diff === 1 || diff === 45;
          if (!isNeighbor) continue;

          const dist = Math.hypot(a.px - b.px, a.py - b.py);
          if (dist > base * 0.16) continue;

          ctx.strokeStyle = rgba(col, 0.55);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(a.px, a.py);
          ctx.lineTo(b.px, b.py);
          ctx.stroke();
        }
      }

      // Red interna (malla sutil estilo telaraña como en el slide 3)
      const maxIntraDist = base * 0.075;
      for (let i = 0; i < pts.length; i += 1) {
        const a = pts[i];
        for (let j = i + 1; j < pts.length; j += 2) {
          const b = pts[j];
          const dist = Math.hypot(a.px - b.px, a.py - b.py);
          if (dist > maxIntraDist) continue;
          const strength = 1 - dist / maxIntraDist;
          ctx.strokeStyle = rgba(CONFIG.palette.eventSilver, 0.06 + strength * 0.18);
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(a.px, a.py);
          ctx.lineTo(b.px, b.py);
          ctx.stroke();
        }
      }
    }

    // 2. Red inter-grupal ("conectados entre sí como en una red como la de la 3"):
    // Hilos dorados entre los 3 grupos, con tensión visible cuando se halan.
    const pull = this.triadPull || { pair: null, tension: 0 };
    const pairs = [
      [0, 1],
      [1, 2],
      [2, 0],
    ];

    for (const [g1, g2] of pairs) {
      const pts1 = groups[g1];
      const pts2 = groups[g2];
      if (!pts1.length || !pts2.length) continue;

      const isPullingThisPair = pull.pair && pull.pair[0] === g1 && pull.pair[1] === g2;
      const tension = isPullingThisPair ? pull.tension : 0;

      const maxInterDist = base * 0.55;
      let drawn = 0;
      for (let i = 0; i < pts1.length && drawn < 10; i += 3) {
        const a = pts1[i];
        for (let j = 0; j < pts2.length && drawn < 10; j += 4) {
          const b = pts2[j];
          const dist = Math.hypot(a.px - b.px, a.py - b.py);
          if (dist > maxInterDist) continue;

          const strength = 1 - dist / maxInterDist;
          const alpha = Math.min(0.85, (0.12 + strength * 0.28) * (1 + tension * 1.5));
          ctx.strokeStyle = rgba(CONFIG.palette.forumGold, alpha);
          ctx.lineWidth = 0.9 + tension * 1.2;
          ctx.beginPath();
          ctx.moveTo(a.px, a.py);
          ctx.lineTo(b.px, b.py);
          ctx.stroke();
          drawn += 1;
        }
      }
    }

    // 3. En slide 5: mientras el cúmulo se reúne o viaja hacia las figuras
    if (isImpact && this.momentTime < 5.3) {
      for (const p of this.particles) {
        if (!p.isCompleter || p.triadAlpha < 0.2 || p.isJoined) continue;
        const distToCenter = Math.hypot(p.px - center.x, p.py - center.y);
        if (distToCenter > base * 0.015 && distToCenter < base * 0.45) {
          ctx.strokeStyle = rgba(CONFIG.palette.eventCyan, 0.22);
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.moveTo(center.x, center.y);
          ctx.lineTo(p.px, p.py);
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }

  drawTriadParticles(ctx, isImpact) {
    const alphaBoost = this.hasBackgroundAsset() ? 0.82 : 1;
    const sizeBoost = this.hasBackgroundAsset() ? 0.76 : 1;
    const groupColors = [CONFIG.palette.eventCyan, CONFIG.palette.eventRed, CONFIG.palette.eventMagenta];

    ctx.save();
    ctx.shadowBlur = 9;

    for (const p of this.particles) {
      const alphaVal = p.triadAlpha ?? 1;
      if (alphaVal < 0.02) continue;

      let color;
      let particleSize = p.size * sizeBoost;

      if (p.isCompleter && isImpact && !p.isJoined) {
        // En tránsito o en el centro: brillo dorado / cian intenso
        color = CONFIG.palette.forumGold;
        particleSize *= 1.28;
      } else {
        color = groupColors[p.triadGroup] || CONFIG.palette.eventSilver;
      }

      const pulse = 0.72 + Math.sin(this.time * 1.4 + p.drift) * 0.18;
      const alpha = Math.min(0.96, alphaVal * alphaBoost * pulse);

      ctx.shadowColor = rgba(color, Math.min(1, alpha * 1.5));
      ctx.fillStyle = rgba(color, alpha);
      ctx.beginPath();
      ctx.arc(p.px, p.py, particleSize, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }

  // === Foto circular con borde desvanecido ===
  ensurePhotoBuffer() {
    if (!this.photoBuffer) {
      this.photoBuffer = document.createElement("canvas");
      this.photoBufferCtx = this.photoBuffer.getContext("2d");
    }
  }

  loadPhoto(src) {
    if (this.photoSrc === src) return;
    this.photoSrc = src;
    this.photoImg = null;
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      if (this.photoSrc === src) this.photoImg = img;
    };
    img.src = src;
  }

  drawCircularPhoto(ctx, cx, cy, diameter, opacity = 1) {
    if (!this.photoImg) return;
    this.ensurePhotoBuffer();
    const size = Math.max(2, Math.round(diameter));
    if (this.photoBuffer.width !== size || this.photoBuffer.height !== size) {
      this.photoBuffer.width = size;
      this.photoBuffer.height = size;
    }
    const bctx = this.photoBufferCtx;
    bctx.clearRect(0, 0, size, size);
    const img = this.photoImg;
    const scale = Math.max(size / img.width, size / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    bctx.save();
    bctx.globalCompositeOperation = "source-over";
    bctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
    bctx.globalCompositeOperation = "destination-in";
    const grad = bctx.createRadialGradient(size / 2, size / 2, size * 0.26, size / 2, size / 2, size * 0.5);
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    bctx.fillStyle = grad;
    bctx.beginPath();
    bctx.arc(size / 2, size / 2, size / 2, 0, TAU);
    bctx.fill();
    bctx.restore();

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.drawImage(this.photoBuffer, cx - size / 2, cy - size / 2);
    ctx.restore();
  }

  drawMomentPhoto(ctx) {
    if (!this.photoConfig || !this.photoImg) return;
    const base = Math.min(this.width, this.height);
    const diameter = base * (this.photoConfig.diameter || 0.3);
    let cx;
    let cy;
    if (this.photoConfig.anchor === "array-center") {
      const center = this.getArrayCenter();
      cx = center.x;
      cy = center.y;
    } else if (this.photoConfig.anchor && typeof this.photoConfig.anchor === "object") {
      cx = this.width * this.photoConfig.anchor.x;
      cy = this.height * this.photoConfig.anchor.y;
    } else {
      cx = this.width * 0.5;
      cy = this.height * 0.5;
    }
    this.drawCircularPhoto(ctx, cx, cy, diameter, 0.94);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setMoment(moment) {
    this.current = moment;
    this.momentTime = 0;
    this.momentHash = makeHash(moment.id);
    this.target = {
      ...moment.behavior,
      intensity: moment.intensity,
    };
    this.colors = moment.colors;
    if (moment.state === "opening") {
      for (const p of this.particles) {
        const route = this.getOpeningRoute(p);
        p.px = route.startX;
        p.py = route.startY;
      }
    }
    if (moment.state === "duality") {
      for (const p of this.particles) {
        const target = this.getDualityTarget(p);
        p.px = target.x;
        p.py = target.y;
      }
    }

    const assetCfg = CONFIG.assets.byMoment?.[moment.id];
    const resolvedAsset = assetCfg === false ? null : assetCfg || moment.asset;
    if (resolvedAsset?.type === "image" && resolvedAsset.placement === "circle" && resolvedAsset.src) {
      this.photoConfig = { anchor: resolvedAsset.anchor || "center", diameter: resolvedAsset.diameter || 0.32 };
      this.loadPhoto(resolvedAsset.src);
    } else {
      this.photoConfig = null;
    }
  }

  update() {
    this.time += 1 / 60;
    this.momentTime += 1 / 60;
    if (!this.target) return;
    for (const key of Object.keys(this.params)) {
      this.params[key] = lerp(this.params[key], this.target[key], CONFIG.transitionSpeed);
    }
  }

  hasBackgroundAsset() {
    const configuredAsset = CONFIG.assets.byMoment?.[this.current?.id];
    const asset = configuredAsset === false ? null : configuredAsset || this.current?.asset;
    return asset?.placement === "background";
  }

  render() {
    this.update();
    const ctx = this.ctx;
    const hasBackgroundAsset = this.hasBackgroundAsset();
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawBackground(ctx, hasBackgroundAsset);
    this.drawMomentPhoto(ctx);
    this.drawSpatialMotifs(ctx);
    this.drawArchive(ctx);
    this.drawArchitecture(ctx);
    this.updateParticles();
    this.drawConnections(ctx);
    this.drawSpiral(ctx);
    this.drawParticles(ctx);
    this.drawStateGesture(ctx);
  }

  getOpeningRoute(p) {
    const cx = this.width * 0.64;
    const cy = this.height * 0.46;
    const base = Math.min(this.width, this.height);
    const seed = p.seed + this.momentHash * 0.01;
    const outbound = p.seed % 2 === 0;
    const farAngle = seededUnit(seed + 5) * TAU;
    const farDx = Math.cos(farAngle);
    const farDy = Math.sin(farAngle);
    const xLimit = farDx > 0 ? this.width * 0.94 : this.width * 0.06;
    const yLimit = farDy > 0 ? this.height * 0.9 : this.height * 0.08;
    const scaleX = Math.abs(farDx) < 0.001 ? Infinity : (xLimit - cx) / farDx;
    const scaleY = Math.abs(farDy) < 0.001 ? Infinity : (yLimit - cy) / farDy;
    const farScale = Math.min(scaleX, scaleY) * (0.86 + seededUnit(seed + 31) * 0.1);
    const tangent = seededUnit(seed + 37) - 0.5;
    const farX = clamp(cx + farDx * farScale + -farDy * tangent * base * 0.08, this.width * 0.04, this.width * 0.96);
    const farY = clamp(cy + farDy * farScale + farDx * tangent * base * 0.06, this.height * 0.06, this.height * 0.92);
    const coreAngle =
      seededUnit(seed + 12) * TAU +
      this.momentTime * (0.012 + seededUnit(seed + 22) * 0.01) * (outbound ? 1 : -1);
    const coreX = cx + Math.cos(coreAngle) * base * (0.045 + seededUnit(seed + 17) * 0.035);
    const coreY = cy + Math.sin(coreAngle) * base * (0.025 + seededUnit(seed + 19) * 0.025);
    const encounterX = cx - base * 0.14 + (seededUnit(seed + 41) - 0.5) * base * 0.006;
    const encounterY = cy + (p.lane - 1) * base * 0.004 + (seededUnit(seed + 43) - 0.5) * base * 0.004;
    const finalX = cx + Math.cos(coreAngle + p.lane * 0.42) * base * (0.07 + seededUnit(seed + 47) * 0.04);
    const finalY = cy + Math.sin(coreAngle + p.lane * 0.42) * base * (0.035 + seededUnit(seed + 53) * 0.025);
    const inboundControlX = lerp(farX, encounterX, 0.58) + Math.cos(farAngle + Math.PI / 2) * base * 0.08;
    const inboundControlY = lerp(farY, encounterY, 0.58) + Math.sin(farAngle + Math.PI / 2) * base * 0.05;
    const outboundControlX = lerp(coreX, encounterX, 0.5) + Math.cos(coreAngle - Math.PI / 2) * base * 0.05;
    const outboundControlY = lerp(coreY, encounterY, 0.5) + Math.sin(coreAngle - Math.PI / 2) * base * 0.035;
    const finalControlX = lerp(encounterX, finalX, 0.52) + base * 0.045;
    const finalControlY = lerp(encounterY, finalY, 0.52) - base * 0.018;

    return {
      outbound,
      farX,
      farY,
      coreX,
      coreY,
      encounterX,
      encounterY,
      finalX,
      finalY,
      inboundControlX,
      inboundControlY,
      outboundControlX,
      outboundControlY,
      finalControlX,
      finalControlY,
      startX: outbound ? coreX : farX,
      startY: outbound ? coreY : farY,
    };
  }

  getOpeningPosition(route, drift = 0) {
    const inboundProgress = smoothstep(0.5, 6.6, this.momentTime);
    const outboundProgress = smoothstep(3.2, 6.6, this.momentTime);
    const finalPull = smoothstep(8.4, 15.2, this.momentTime);
    const firstProgress = route.outbound ? outboundProgress : inboundProgress;
    const startX = route.outbound ? route.coreX : route.farX;
    const startY = route.outbound ? route.coreY : route.farY;
    const controlX = route.outbound ? route.outboundControlX : route.inboundControlX;
    const controlY = route.outbound ? route.outboundControlY : route.inboundControlY;
    const meetingX = quadraticPoint(startX, controlX, route.encounterX, firstProgress);
    const meetingY = quadraticPoint(startY, controlY, route.encounterY, firstProgress);
    const spiralX = quadraticPoint(route.encounterX, route.finalControlX, route.finalX, finalPull);
    const spiralY = quadraticPoint(route.encounterY, route.finalControlY, route.finalY, finalPull);
    const breath = Math.sin(this.time * 0.16 + drift) * Math.min(this.width, this.height) * 0.0035 * (1 - finalPull);

    return {
      x: lerp(meetingX, spiralX, finalPull) + breath,
      y: lerp(meetingY, spiralY, finalPull) + breath * 0.42,
      inboundProgress,
      outboundProgress,
      finalPull,
    };
  }

  getDualityRole(p) {
    if (p.seed % 7 === 0 || p.seed % 23 === 0) return "hybrid";
    return p.seed % 2 === 0 ? "young" : "experience";
  }

  getDualityTarget(p) {
    const cx = this.width * 0.64;
    const cy = this.height * 0.46;
    const base = Math.min(this.width, this.height);
    const seed = p.seed + this.momentHash * 0.01;
    const role = this.getDualityRole(p);

    if (role === "young") {
      const centerX = this.width * 0.41;
      const centerY = this.height * 0.5;
      const angle =
        seededUnit(seed) * TAU +
        this.time * (0.44 + seededUnit(seed + 4) * 0.2) +
        Math.sin(this.time * 1.6 + p.drift) * 0.34;
      const radius = base * (0.17 + seededUnit(seed + 31) * 0.18);
      const turbulence = base * (0.018 + seededUnit(seed + 11) * 0.02);

      return {
        role,
        young: true,
        experience: false,
        hybrid: false,
        x: centerX + Math.cos(angle) * radius + Math.sin(this.time * 1.1 + seed) * turbulence,
        y: centerY + Math.sin(angle) * radius * (0.42 + seededUnit(seed + 19) * 0.12) + Math.cos(this.time * 1.35 + seed) * turbulence * 0.6,
      };
    }

    if (role === "experience") {
      const centerX = this.width * 0.76;
      const centerY = this.height * 0.46;
      const angle = seededUnit(seed) * TAU - this.time * (0.018 + seededUnit(seed + 4) * 0.014);
      const ring = p.seed % 7;
      const radius = base * (0.085 + ring * 0.022 + seededUnit(seed + 37) * 0.04);
      const microShift = Math.sin(this.time * 0.22 + p.drift) * base * 0.012;

      return {
        role,
        young: false,
        experience: true,
        hybrid: false,
        x: centerX + Math.cos(angle) * radius + microShift,
        y: centerY + Math.sin(angle) * radius * 0.6 + microShift * 0.35,
      };
    }

    const angle =
      seededUnit(seed) * TAU +
      this.time * (0.1 + seededUnit(seed + 4) * 0.05) * (p.seed % 2 === 0 ? 1 : -1) +
      Math.sin(this.time * 0.55 + p.drift) * 0.08;
    const radius = base * (0.1 + seededUnit(seed + 31) * 0.15);

    return {
      role,
      young: false,
      experience: false,
      hybrid: true,
      x: cx + Math.cos(angle) * radius + Math.sin(this.time * 0.55 + seed) * base * 0.012,
      y: cy + Math.sin(angle) * radius * 0.62 + Math.cos(this.time * 0.5 + seed) * base * 0.007,
    };
  }

  drawBackground(ctx, hasBackgroundAsset = false) {
    if (hasBackgroundAsset) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const haze = ctx.createRadialGradient(
        this.width * 0.64,
        this.height * 0.48,
        0,
        this.width * 0.64,
        this.height * 0.48,
        this.width * 0.48,
      );
      haze.addColorStop(0, rgba(this.colors[1], 0.05 + this.params.intensity * 0.04));
      haze.addColorStop(0.54, rgba(this.colors[0], 0.018));
      haze.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
      return;
    }

    const gradient = ctx.createLinearGradient(0, 0, this.width, this.height);
    gradient.addColorStop(0, "#050607");
    gradient.addColorStop(0.44, rgba(this.colors[0], 0.12 + this.params.intensity * 0.08));
    gradient.addColorStop(1, "#111315");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    const glow = ctx.createRadialGradient(
      this.width * 0.72,
      this.height * 0.44,
      0,
      this.width * 0.72,
      this.height * 0.44,
      this.width * 0.56,
    );
    glow.addColorStop(0, rgba(this.colors[1], 0.16 * this.params.intensity));
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  drawSpatialMotifs(ctx) {
    const state = this.current?.state;
    if (state === "genesis") {
      this.drawGenesisAmbient(ctx);
      return;
    }

    if (state === "ingreso") {
      return;
    }

    if (state === "telarana") {
      this.drawTelaranaAmbient(ctx);
      return;
    }

    if (state === "latent") {
      this.drawLatentPotential(ctx);
      return;
    }

    if (state === "architecture" || state === "opening") {
      return;
    }

    if (state === "triad" || state === "impact") {
      this.drawTriadAmbient(ctx, state === "impact");
      return;
    }

    if (state === "community") {
      this.drawMatureBonds(ctx, 0.72);
      return;
    }

    if (state === "trust") {
      this.drawMatureBonds(ctx, 0.96);
      return;
    }

    if (state === "routes") {
      this.drawLivingRoutes(ctx, 0.72, 0.52);
      return;
    }

    if (state === "duality") {
      this.drawDualGenerationField(ctx, false);
      return;
    }

    if (state === "convergence") {
      this.drawDualGenerationField(ctx, true);
      this.drawMatureBonds(ctx, 0.92);
      return;
    }

    if (state === "present") {
      this.drawEnergyTraces(ctx, 0.86);
      return;
    }

    if (state === "future") {
      this.drawLivingRoutes(ctx, 1, 0.9);
      this.drawMatureBonds(ctx, 0.9);
      return;
    }

    if (state === "qr") {
      this.drawLivingRoutes(ctx, 0.88, 0.62);
      this.drawMatureBonds(ctx, 1.08);
      return;
    }

    this.drawLivingRoutes(ctx, 0.72, 0.5);
    this.drawMatureBonds(ctx, 0.62);
    this.drawEnergyTraces(ctx);
  }

  drawLatentPotential(ctx) {
    const cx = this.width * 0.66;
    const cy = this.height * 0.47;
    const base = Math.min(this.width, this.height);
    const amount = 0.08 + this.params.intensity * 0.08;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i += 1) {
      const phase = (this.time * 0.045 + i / 3) % 1;
      const r = base * (0.24 + phase * 0.28);
      ctx.strokeStyle = rgba(this.colors[i], (1 - phase) * amount);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.5, -0.08, 0.2 * TAU, 0.86 * TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawTelaranaAmbient(ctx) {
    const base = Math.min(this.width, this.height);
    const center = this.redCenter();
    const pull = this.getTelaranaPull();

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    const coreGlow = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, base * 0.22);
    coreGlow.addColorStop(0, rgba(this.colors[0], 0.15 + this.params.intensity * 0.08));
    coreGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = coreGlow;
    ctx.fillRect(center.x - base * 0.22, center.y - base * 0.22, base * 0.44, base * 0.44);

    for (let i = 0; i < this.redClusterCount; i += 1) {
      const anchor = this.redClusterAnchor(i, pull);
      const r = base * (0.075 + (1 - pull) * 0.03);
      const glow = ctx.createRadialGradient(anchor.x, anchor.y, 0, anchor.x, anchor.y, r);
      glow.addColorStop(0, rgba(this.colors[1] || this.colors[0], 0.11 * (1 - pull * 0.4)));
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(anchor.x - r, anchor.y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  drawTelaranaWeb(ctx) {
    const center = this.redCenter();
    const base = Math.min(this.width, this.height);
    const boost = this.hasBackgroundAsset() ? 0.72 : 1;

    ctx.save();
    ctx.lineCap = "round";

    // Hilos radiales: del centro (la Universidad) a cada partícula joven que
    // ya salió hacia su cúmulo — la telaraña que conecta el núcleo con el mundo.
    for (const p of this.particles) {
      if (p.redRole !== "web") continue;
      const attach = p.redAttach ?? 0;
      if (attach < 0.04) continue;
      const alpha = Math.min(0.5, attach * 0.42) * boost;
      ctx.strokeStyle = rgba(CONFIG.palette.forumGold, alpha);
      ctx.lineWidth = 1 + attach * 0.6;
      ctx.beginPath();
      ctx.moveTo(center.x, center.y);
      ctx.lineTo(p.px, p.py);
      ctx.stroke();
    }

    // Red local dentro de cada cúmulo: conecta semillas y partículas jóvenes
    // ya adheridas, dando la textura tejida de la telaraña alrededor de cada cúmulo.
    const maxDist = base * 0.085;
    for (let i = 0; i < this.particles.length; i += 1) {
      const a = this.particles[i];
      if (a.redRole !== "seed" && a.redRole !== "web") continue;
      if (a.redRole === "web" && (a.redAttach ?? 0) < 0.55) continue;
      for (let j = i + 1; j < this.particles.length; j += 1) {
        const b = this.particles[j];
        if (b.redCluster !== a.redCluster) continue;
        if (b.redRole !== "seed" && b.redRole !== "web") continue;
        if (b.redRole === "web" && (b.redAttach ?? 0) < 0.55) continue;
        const dist = Math.hypot(a.px - b.px, a.py - b.py);
        if (dist > maxDist) continue;
        const strength = 1 - dist / maxDist;
        ctx.strokeStyle = rgba(CONFIG.palette.eventSilver, 0.08 + strength * 0.22);
        ctx.lineWidth = 0.8 + strength * 1.1;
        ctx.beginPath();
        ctx.moveTo(a.px, a.py);
        ctx.lineTo(b.px, b.py);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  drawGenesisAmbient(ctx) {
    const base = Math.min(this.width, this.height);
    const groundY = this.height * 0.84;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    ctx.fillStyle = rgba(CONFIG.palette.eventSilver, 0.03);
    for (const p of this.particles) {
      if (!p.castle) continue;
      const target = this.castleLocalToCanvas(p.castle.x, p.castle.y);
      ctx.beginPath();
      ctx.arc(target.x, target.y, 1.1, 0, TAU);
      ctx.fill();
    }

    const glow = ctx.createLinearGradient(0, groundY - base * 0.03, 0, groundY + base * 0.06);
    glow.addColorStop(0, "rgba(0,0,0,0)");
    glow.addColorStop(0.5, rgba(this.colors[2] || this.colors[0], 0.07));
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(this.width * 0.08, groundY - base * 0.03, this.width * 0.84, base * 0.09);

    ctx.restore();
  }

  drawGenesisConnections(ctx) {
    const base = Math.min(this.width, this.height);
    const maxDist = base * 0.052;
    const boost = this.hasBackgroundAsset() ? 0.72 : 1;

    ctx.save();
    ctx.lineCap = "round";
    for (let i = 0; i < this.particles.length; i += 1) {
      const a = this.particles[i];
      const aProgress = a.buildProgress ?? 0;
      if (aProgress < 0.08) continue;
      for (let j = i + 1; j < this.particles.length; j += 2) {
        const b = this.particles[j];
        const bProgress = b.buildProgress ?? 0;
        if (bProgress < 0.08) continue;
        const dist = Math.hypot(a.px - b.px, a.py - b.py);
        if (dist > maxDist) continue;
        const strength = (1 - dist / maxDist) * Math.min(aProgress, bProgress);
        const sameOld = a.generation === "old" && b.generation === "old";
        const sameNew = a.generation === "new" && b.generation === "new";
        const color = sameOld ? CONFIG.palette.eventRed : sameNew ? CONFIG.palette.eventCyan : CONFIG.palette.forumGold;
        const alpha = strength * (sameOld || sameNew ? 0.4 : 0.6) * boost;
        if (alpha < 0.015) continue;
        ctx.strokeStyle = rgba(color, alpha);
        ctx.lineWidth = sameOld || sameNew ? 1 : 1.5;
        ctx.beginPath();
        ctx.moveTo(a.px, a.py);
        ctx.lineTo(b.px, b.py);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawIngresoConnections(ctx) {
    const base = Math.min(this.width, this.height);
    const maxDist = base * 0.07;
    const boost = this.hasBackgroundAsset() ? 0.72 : 1;

    ctx.save();
    ctx.lineCap = "round";
    for (let i = 0; i < this.particles.length; i += 1) {
      const a = this.particles[i];
      const aProgress = a.buildProgress ?? 0;
      if (aProgress < 0.2) continue;
      for (let j = i + 1; j < this.particles.length; j += 2) {
        const b = this.particles[j];
        if (a.generation !== b.generation) continue;
        const bProgress = b.buildProgress ?? 0;
        if (bProgress < 0.2) continue;
        const dist = Math.hypot(a.px - b.px, a.py - b.py);
        if (dist > maxDist) continue;
        const strength = 1 - dist / maxDist;
        const color = a.generation === "old" ? CONFIG.palette.eventRed : CONFIG.palette.eventCyan;
        const alpha = strength * 0.34 * boost;
        if (alpha < 0.015) continue;
        ctx.strokeStyle = rgba(color, alpha);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.px, a.py);
        ctx.lineTo(b.px, b.py);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawTriadFields(ctx, converging = false) {
    const anchors = [
      [this.width * 0.58, this.height * 0.3],
      [this.width * 0.78, this.height * 0.62],
      [this.width * 0.43, this.height * 0.66],
    ];
    const colors = [CONFIG.palette.eventCyan, CONFIG.palette.eventRed, CONFIG.palette.eventMagenta];
    const center = [this.width * 0.64, this.height * 0.5];
    const amount = converging ? 0.18 : 0.12;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < anchors.length; i += 1) {
      const anchor = anchors[i];
      const pulse = 0.5 + Math.sin(this.time * 0.9 + i) * 0.5;
      const x = converging ? lerp(anchor[0], center[0], 0.34 + pulse * 0.08) : anchor[0];
      const y = converging ? lerp(anchor[1], center[1], 0.34 + pulse * 0.08) : anchor[1];
      const r = Math.min(this.width, this.height) * (converging ? 0.095 : 0.075);

      const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
      glow.addColorStop(0, rgba(colors[i], amount));
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);

      if (converging) {
        ctx.strokeStyle = rgba(colors[i], 0.12);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(center[0], center[1] - 18, center[0], center[1]);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawDualGenerationField(ctx, converged = false) {
    const base = Math.min(this.width, this.height);
    const vision = [this.width * 0.64, this.height * 0.46];
    const youngCenter = [this.width * 0.41, this.height * 0.5];
    const experienceCenter = [this.width * 0.76, this.height * 0.46];
    const merge = converged ? 0.52 : 0;
    const centers = [
      [lerp(youngCenter[0], this.width * 0.65, merge), lerp(youngCenter[1], this.height * 0.48, merge)],
      [lerp(experienceCenter[0], this.width * 0.65, merge), lerp(experienceCenter[1], this.height * 0.48, merge)],
    ];

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    if (!converged) {
      ctx.lineCap = "round";

      const youngGlow = ctx.createRadialGradient(youngCenter[0] - base * 0.04, youngCenter[1], 0, youngCenter[0], youngCenter[1], base * 0.48);
      youngGlow.addColorStop(0, rgba(CONFIG.palette.eventCyan, 0.12));
      youngGlow.addColorStop(0.45, rgba(CONFIG.palette.eventRed, 0.06));
      youngGlow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = youngGlow;
      ctx.fillRect(youngCenter[0] - base * 0.52, youngCenter[1] - base * 0.32, base * 1.04, base * 0.64);

      const experienceGlow = ctx.createRadialGradient(
        experienceCenter[0],
        experienceCenter[1],
        0,
        experienceCenter[0],
        experienceCenter[1],
        base * 0.34,
      );
      experienceGlow.addColorStop(0, rgba(CONFIG.palette.eventSilver, 0.18));
      experienceGlow.addColorStop(0.5, rgba(CONFIG.palette.eventMagenta, 0.1));
      experienceGlow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = experienceGlow;
      ctx.fillRect(experienceCenter[0] - base * 0.42, experienceCenter[1] - base * 0.29, base * 0.84, base * 0.58);

      const visionGlow = ctx.createRadialGradient(vision[0], vision[1], 0, vision[0], vision[1], base * 0.42);
      visionGlow.addColorStop(0, rgba(CONFIG.palette.eventSilver, 0.18));
      visionGlow.addColorStop(0.28, rgba(CONFIG.palette.eventCyan, 0.1));
      visionGlow.addColorStop(0.58, rgba(CONFIG.palette.eventRed, 0.06));
      visionGlow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = visionGlow;
      ctx.fillRect(vision[0] - base * 0.44, vision[1] - base * 0.3, base * 0.88, base * 0.6);

      ctx.save();
      ctx.setLineDash([base * 0.018, base * 0.026]);
      for (let i = 0; i < 10; i += 1) {
        const r = base * (0.17 + i * 0.028);
        const start = this.time * (0.42 + i * 0.024) + i * 0.58;
        const end = start + TAU * (0.12 + (i % 4) * 0.028);
        const flicker = Math.max(0, Math.sin(this.time * 2.7 + i * 0.9));
        ctx.strokeStyle = rgba(i % 2 ? CONFIG.palette.eventRed : CONFIG.palette.eventCyan, 0.04 + flicker * 0.08);
        ctx.lineWidth = 0.75 + (i % 3) * 0.18;
        ctx.beginPath();
        ctx.ellipse(youngCenter[0] - base * 0.04, youngCenter[1], r, r * 0.46, 0.12, start, end);
        ctx.stroke();
      }
      ctx.restore();

      for (let i = 0; i < 9; i += 1) {
        const r = base * (0.09 + i * 0.024);
        const start = -this.time * 0.02 + i * 0.18;
        ctx.strokeStyle = rgba(i % 2 ? CONFIG.palette.eventMagenta : CONFIG.palette.eventSilver, 0.14 + i * 0.028);
        ctx.lineWidth = 1.35 + i * 0.14;
        ctx.beginPath();
        ctx.ellipse(experienceCenter[0], experienceCenter[1], r, r * 0.62, -0.07, start, start + TAU * 0.72);
        ctx.stroke();
      }

      for (let i = 0; i < 9; i += 1) {
        const t = i / 8;
        const yOffset = (t - 0.5) * base * 0.2;
        const leftAlpha = 0.045 + Math.max(0, Math.sin(this.time * 1.8 + i)) * 0.035;
        ctx.strokeStyle = rgba(i % 2 ? CONFIG.palette.eventRed : CONFIG.palette.eventCyan, leftAlpha);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(youngCenter[0] + base * 0.06, youngCenter[1] + yOffset);
        ctx.bezierCurveTo(
          lerp(youngCenter[0], vision[0], 0.35),
          youngCenter[1] + yOffset - base * 0.05,
          lerp(youngCenter[0], vision[0], 0.76),
          vision[1] - yOffset * 0.25,
          vision[0],
          vision[1],
        );
        ctx.stroke();

        ctx.strokeStyle = rgba(i % 2 ? CONFIG.palette.eventMagenta : CONFIG.palette.eventSilver, 0.075 + t * 0.032);
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(experienceCenter[0] - base * 0.12, experienceCenter[1] + yOffset * 0.62);
        ctx.bezierCurveTo(
          lerp(experienceCenter[0], vision[0], 0.35),
          experienceCenter[1] - base * 0.025 + yOffset * 0.28,
          lerp(experienceCenter[0], vision[0], 0.74),
          vision[1] + yOffset * 0.22,
          vision[0],
          vision[1],
        );
        ctx.stroke();
      }

      for (let i = 0; i < 7; i += 1) {
        const phase = (this.time * 0.08 + i / 7) % 1;
        const hybridColor = i % 3 === 0 ? CONFIG.palette.eventSilver : i % 3 === 1 ? CONFIG.palette.eventCyan : CONFIG.palette.eventRed;
        ctx.strokeStyle = rgba(hybridColor, 0.16 + (1 - phase) * 0.08);
        ctx.lineWidth = 1 + i * 0.22;
        ctx.beginPath();
        ctx.ellipse(vision[0], vision[1], base * (0.11 + phase * 0.15), base * (0.06 + phase * 0.085), 0.08, 0, TAU);
        ctx.stroke();
      }
    }

    if (converged) {
      ctx.lineCap = "round";
      for (let i = 0; i < 10; i += 1) {
        const y = this.height * (0.31 + i * 0.044);
        ctx.strokeStyle = rgba(this.colors[i % this.colors.length], 0.1 + this.params.network * 0.08);
        ctx.lineWidth = 1.2 + (i % 3) * 0.25;
        ctx.beginPath();
        ctx.moveTo(centers[0][0] - base * 0.14, y);
        ctx.bezierCurveTo(this.width * 0.58, y - base * 0.06, this.width * 0.72, y + base * 0.06, centers[1][0] + base * 0.14, y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawDualityForeground(ctx) {
    const base = Math.min(this.width, this.height);
    const vision = [this.width * 0.64, this.height * 0.46];
    const experienceCenter = [this.width * 0.76, this.height * 0.46];
    const groups = {
      young: [],
      experience: [],
      hybrid: [],
    };

    for (const p of this.particles) {
      groups[this.getDualityRole(p)].push(p);
    }

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    ctx.save();
    ctx.setLineDash([base * 0.005, base * 0.018]);
    for (let i = 0; i < 30; i += 1) {
      const a = groups.young[(i * 3) % groups.young.length];
      const b = groups.young[(i * 11 + 7) % groups.young.length];
      if (!a || !b) continue;
      const flicker = smoothstep(0.52, 1, (Math.sin(this.time * 4.2 + i * 0.73) + 1) / 2);
      const color = i % 2 === 0 ? CONFIG.palette.eventCyan : CONFIG.palette.eventRed;
      const bend = Math.sin(this.time * 1.7 + i) * base * 0.065;

      ctx.strokeStyle = rgba(color, 0.024 + flicker * 0.12);
      ctx.lineWidth = 0.55 + flicker * 0.62;
      ctx.beginPath();
      ctx.moveTo(a.px, a.py);
      ctx.quadraticCurveTo((a.px + b.px) * 0.5 + bend, (a.py + b.py) * 0.5 - bend * 0.38, b.px, b.py);
      ctx.stroke();
    }
    ctx.restore();

    const experienceMaxDist = base * 0.16;
    for (let i = 0; i < groups.experience.length; i += 1) {
      const a = groups.experience[i];
      for (let j = i + 1; j < groups.experience.length; j += 2) {
        const b = groups.experience[j];
        if ((a.seed + b.seed) % 5 === 0) continue;
        const dist = Math.hypot(a.px - b.px, a.py - b.py);
        if (dist > experienceMaxDist) continue;
        const strength = 1 - dist / experienceMaxDist;
        ctx.strokeStyle = rgba((i + j) % 4 === 0 ? CONFIG.palette.eventMagenta : CONFIG.palette.eventSilver, 0.075 + strength * 0.3);
        ctx.lineWidth = 0.9 + strength * 2;
        ctx.beginPath();
        ctx.moveTo(a.px, a.py);
        ctx.lineTo(b.px, b.py);
        ctx.stroke();
      }
    }

    const structuralPoints = [];
    for (let i = 0; i < 28; i += 1) {
      const angle = (i / 28) * TAU - this.time * 0.014;
      const radius = base * (0.09 + seededUnit(i + 330) * 0.18);
      structuralPoints.push([
        experienceCenter[0] + Math.cos(angle) * radius,
        experienceCenter[1] + Math.sin(angle) * radius * 0.62,
      ]);
    }
    for (let i = 0; i < structuralPoints.length; i += 1) {
      const a = structuralPoints[i];
      for (let step = 1; step <= 3; step += 1) {
        const b = structuralPoints[(i + step) % structuralPoints.length];
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (dist > base * 0.17 || (i + step) % 4 === 0) continue;
        ctx.strokeStyle = rgba((i + step) % 5 === 0 ? CONFIG.palette.eventMagenta : CONFIG.palette.eventSilver, 0.1 + (1 - dist / (base * 0.17)) * 0.15);
        ctx.lineWidth = 0.8 + step * 0.16;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }

      ctx.fillStyle = rgba(CONFIG.palette.eventSilver, 0.24);
      ctx.beginPath();
      ctx.arc(a[0], a[1], 1.7, 0, TAU);
      ctx.fill();
    }

    const hybridMaxDist = base * 0.22;
    for (let i = 0; i < groups.hybrid.length; i += 1) {
      const a = groups.hybrid[i];
      const color = i % 3 === 0 ? CONFIG.palette.eventSilver : i % 3 === 1 ? CONFIG.palette.eventCyan : CONFIG.palette.eventRed;
      ctx.strokeStyle = rgba(color, 0.2);
      ctx.lineWidth = 1.45;
      ctx.beginPath();
      ctx.moveTo(vision[0], vision[1]);
      ctx.quadraticCurveTo((vision[0] + a.px) * 0.5, vision[1] - base * 0.035, a.px, a.py);
      ctx.stroke();

      const youngBridge = groups.young[(i * 5 + 3) % groups.young.length];
      const experienceBridge = groups.experience[(i * 7 + 2) % groups.experience.length];
      if (youngBridge) {
        ctx.strokeStyle = rgba(i % 2 === 0 ? CONFIG.palette.eventCyan : CONFIG.palette.eventRed, 0.075);
        ctx.lineWidth = 0.95;
        ctx.beginPath();
        ctx.moveTo(youngBridge.px, youngBridge.py);
        ctx.quadraticCurveTo(lerp(youngBridge.px, a.px, 0.58), lerp(youngBridge.py, a.py, 0.58) - base * 0.035, a.px, a.py);
        ctx.stroke();
      }
      if (experienceBridge) {
        ctx.strokeStyle = rgba(i % 2 === 0 ? CONFIG.palette.eventSilver : CONFIG.palette.eventMagenta, 0.12);
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(experienceBridge.px, experienceBridge.py);
        ctx.quadraticCurveTo(lerp(experienceBridge.px, a.px, 0.48), lerp(experienceBridge.py, a.py, 0.48) + base * 0.025, a.px, a.py);
        ctx.stroke();
      }

      for (let j = i + 1; j < groups.hybrid.length; j += 1) {
        const b = groups.hybrid[j];
        const dist = Math.hypot(a.px - b.px, a.py - b.py);
        if (dist > hybridMaxDist) continue;
        const strength = 1 - dist / hybridMaxDist;
        ctx.strokeStyle = rgba((i + j) % 3 === 0 ? CONFIG.palette.eventSilver : (i + j) % 3 === 1 ? CONFIG.palette.eventCyan : CONFIG.palette.eventRed, 0.1 + strength * 0.28);
        ctx.lineWidth = 1 + strength * 1.75;
        ctx.beginPath();
        ctx.moveTo(a.px, a.py);
        ctx.lineTo(b.px, b.py);
        ctx.stroke();
      }

      ctx.fillStyle = rgba(color, 0.5);
      ctx.beginPath();
      ctx.arc(a.px, a.py, 3, 0, TAU);
      ctx.fill();
    }

    ctx.fillStyle = rgba(CONFIG.palette.eventSilver, 0.48);
    ctx.beginPath();
    ctx.arc(vision[0], vision[1], 4.8, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawForumVolume(ctx, scale = 1) {
    const amount = (0.035 + this.params.architecture * 0.12 + this.params.stability * 0.035) * scale;
    const cx = this.width * 0.64;
    const cy = this.height * 0.48;
    const base = Math.min(this.width, this.height);

    ctx.save();
    ctx.strokeStyle = rgba(CONFIG.palette.eventSilver, amount);
    ctx.lineWidth = 1;

    for (let i = 0; i < 7; i += 1) {
      const depth = i / 6;
      const w = base * (0.18 + depth * 0.62);
      const h = base * (0.08 + depth * 0.28);
      const y = cy + base * (0.22 - depth * 0.18);
      ctx.beginPath();
      ctx.ellipse(cx, y, w, h, -0.16, Math.PI * 1.05, Math.PI * 1.92);
      ctx.stroke();
    }

    for (let i = -4; i <= 4; i += 1) {
      const angle = -0.72 + i * 0.18;
      const nearX = cx + Math.cos(angle) * base * 0.58;
      const nearY = cy + Math.sin(angle) * base * 0.2 + base * 0.16;
      const farX = cx + Math.cos(angle * 0.7) * base * 0.18;
      const farY = cy + Math.sin(angle * 0.7) * base * 0.06 - base * 0.06;
      ctx.beginPath();
      ctx.moveTo(nearX, nearY);
      ctx.quadraticCurveTo(cx + i * base * 0.025, cy + base * 0.03, farX, farY);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawOrbitalNet(ctx, scale = 1) {
    const amount = (0.05 + this.params.network * 0.14 + this.params.spiral * 0.08) * scale;
    const cx = this.width * 0.66;
    const cy = this.height * 0.47;
    const base = Math.min(this.width, this.height);
    const strands = 9;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 1;

    for (let i = 0; i < strands; i += 1) {
      const phase = i / strands;
      ctx.beginPath();
      for (let j = 0; j <= 80; j += 1) {
        const t = j / 80;
        const angle = t * TAU * 0.92 + phase * TAU + this.time * 0.04;
        const r = base * (0.1 + t * 0.4 + Math.sin(t * TAU + phase * TAU) * 0.035);
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r * 0.46;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(i % 3 === 0 ? this.colors[1] : CONFIG.palette.eventSilver, amount * (0.55 + phase * 0.35));
      ctx.stroke();
    }
    ctx.restore();
  }

  drawLivingRoutes(ctx, scale = 1, persistence = 0.55) {
    const cx = this.width * 0.64;
    const cy = this.height * 0.47;
    const base = Math.min(this.width, this.height);
    const routeCount = 9;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    for (let i = 0; i < routeCount; i += 1) {
      const seed = this.momentHash + i * 31;
      const lane = i % this.colors.length;
      const startAngle = seededUnit(seed + 3) * TAU;
      const endAngle = startAngle + (seededUnit(seed + 9) > 0.5 ? 1 : -1) * (0.45 + seededUnit(seed + 11) * 0.7);
      const startR = base * (0.34 + seededUnit(seed + 15) * 0.32);
      const endR = base * (0.08 + seededUnit(seed + 17) * 0.16);
      const startX = cx + Math.cos(startAngle) * startR;
      const startY = cy + Math.sin(startAngle) * startR * 0.58;
      const endX = cx + Math.cos(endAngle) * endR;
      const endY = cy + Math.sin(endAngle) * endR * 0.52;
      const controlX = cx + Math.cos((startAngle + endAngle) * 0.5 + Math.PI / 2) * base * (0.16 + seededUnit(seed + 19) * 0.1);
      const controlY = cy + Math.sin((startAngle + endAngle) * 0.5 + Math.PI / 2) * base * (0.08 + seededUnit(seed + 23) * 0.08);
      const life = 0.35 + 0.65 * smoothstep(0.12, 0.84, (Math.sin(this.time * (0.16 + i * 0.01) + seed) + 1) / 2);
      const alpha = (0.035 + persistence * 0.075) * life * scale;

      ctx.beginPath();
      for (let j = 0; j <= 44; j += 1) {
        const t = j / 44;
        const x = quadraticPoint(startX, controlX, endX, t);
        const y = quadraticPoint(startY, controlY, endY, t);
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(this.colors[lane], alpha);
      ctx.lineWidth = 1 + scale * 0.5;
      ctx.stroke();

      const beadProgress = (seededUnit(seed + 29) + this.time * (0.035 + i * 0.002)) % 1;
      const beadX = quadraticPoint(startX, controlX, endX, beadProgress);
      const beadY = quadraticPoint(startY, controlY, endY, beadProgress);
      ctx.fillStyle = rgba(this.colors[lane], alpha * 2.6);
      ctx.beginPath();
      ctx.arc(beadX, beadY, 1.5 + scale * 1.2, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }

  drawMatureBonds(ctx, scale = 1) {
    const cx = this.width * 0.65;
    const cy = this.height * 0.47;
    const base = Math.min(this.width, this.height);
    const state = this.current?.state;
    const isTrust = state === "trust";
    const amount =
      (0.05 + this.params.network * (isTrust ? 0.18 : 0.12) + this.params.stability * (isTrust ? 0.11 : 0.08)) *
      scale;
    const bondCount = isTrust ? 34 : 18;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    for (let i = 0; i < bondCount; i += 1) {
      const a = this.particles[(i * (isTrust ? 5 : 7)) % this.particles.length];
      const b = this.particles[(i * (isTrust ? 5 : 7) + (isTrust ? 24 : 31)) % this.particles.length];
      const mx = (a.px + b.px) * 0.5;
      const my = (a.py + b.py) * 0.5;
      const pull = isTrust ? 0.1 : state === "qr" ? 0.55 : 0.28;
      const cpX = lerp(mx, cx, pull);
      const cpY = lerp(my, cy, pull) - base * (0.025 + (i % 3) * 0.012);
      const alpha = amount * (isTrust ? 0.62 + (i % 5) * 0.1 : 0.42 + (i % 5) * 0.09);

      ctx.strokeStyle = rgba(this.colors[i % this.colors.length], alpha);
      ctx.lineWidth = isTrust ? 1.35 + scale * 0.72 : 1.1 + scale * 0.55;
      ctx.beginPath();
      ctx.moveTo(a.px, a.py);
      ctx.quadraticCurveTo(cpX, cpY, b.px, b.py);
      ctx.stroke();
    }

    ctx.restore();
  }

  drawEnergyTraces(ctx, scale = 1) {
    const amount = (0.12 + this.params.intensity * 0.18) * scale;
    const cx = this.width * 0.66;
    const cy = this.height * 0.47;
    const base = Math.min(this.width, this.height);
    const colors = [CONFIG.palette.eventCyan, CONFIG.palette.eventRed, CONFIG.palette.eventMagenta];

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let i = 0; i < 16; i += 1) {
      const lane = i % 3;
      const phase = i / 18;
      const angle = phase * TAU * 2.15 + this.time * (0.22 + lane * 0.06);
      const r = base * (0.14 + lane * 0.055 + seededUnit(i + this.momentHash) * 0.22);
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r * 0.5;
      const tail = base * (0.018 + seededUnit(i + 31) * 0.02);
      const tx = x - Math.sin(angle) * tail;
      const ty = y + Math.cos(angle) * tail * 0.5;
      ctx.strokeStyle = rgba(colors[lane], amount);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(x, y);
      ctx.stroke();

      ctx.fillStyle = rgba(colors[lane], amount * 1.25);
      ctx.beginPath();
      ctx.arc(x, y, 1.4 + seededUnit(i + 47) * 1.4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  updateParticles() {
    const cx = this.width * 0.64;
    const cy = this.height * 0.46;
    const radiusBase = Math.min(this.width, this.height) * 0.16;
    const routePull = this.params.network;
    const spiralPull = this.params.spiral;
    const stability = this.params.stability;
    const state = this.current?.state || "latent";

    for (const p of this.particles) {
      const seed = p.seed + this.momentHash * 0.01;
      const depth = 0.5 + seededUnit(seed + 9) * 0.86;
      const angle =
        seededUnit(seed) * TAU +
        this.time * (0.06 + spiralPull * 0.36) * (p.lane % 2 === 0 ? 1 : -1);
      const wave = Math.sin(this.time * (0.4 + routePull) + p.drift) * 0.5 + 0.5;
      let rx = radiusBase * (1.2 + p.lane * 0.42 + spiralPull * 1.95 + wave * 0.28);
      let ry = radiusBase * (0.56 + p.lane * 0.18 + spiralPull * 1.12);

      if (state === "genesis") {
        const target = this.castleLocalToCanvas(p.castle.x, p.castle.y);
        if (p.generation === "old") {
          const groupCount = Math.max(1, this.oldCount - 1);
          const buildFrac = p.buildOrder / groupCount;
          const localOffset = buildFrac * 1.1 + seededUnit(seed + 91) * 0.35;
          const t = Math.max(0, this.momentTime - localOffset);
          const fastEase = smoothstep(0, this.genesisTiming.oldFastEnd, t);
          const slowEase = smoothstep(this.genesisTiming.oldFastEnd, this.genesisTiming.oldSlowEnd, t);
          const progress = clamp(fastEase * 0.72 + slowEase * 0.28, 0, 1);
          const start = this.castleLocalToCanvas(seededUnit(seed + 61), 1.05 + seededUnit(seed + 62) * 0.08);
          const settle = 1 - progress;
          const jitter = Math.sin(this.time * 0.8 + p.drift) * settle * 3;
          p.px = lerp(start.x, target.x, progress) + jitter;
          p.py = lerp(start.y, target.y, progress) + jitter * 0.6;
          p.buildProgress = progress;
        } else {
          const groupCount = Math.max(1, this.particles.length - this.oldCount - 1);
          const buildFrac = p.buildOrder / groupCount;
          const arriveAt = this.genesisTiming.newArriveStart + buildFrac * this.genesisTiming.newArriveSpan;
          const t = Math.max(0, this.momentTime - arriveAt);
          const ease = smoothstep(0, this.genesisTiming.newEachDuration, t);
          const start = this.castleLocalToCanvas(
            1.42 + seededUnit(seed + 81) * 0.14,
            p.castle.y + (seededUnit(seed + 82) - 0.5) * 0.12,
          );
          const settle = 1 - ease;
          const jitter = Math.sin(this.time * 1.1 + p.drift) * settle * 2;
          p.px = lerp(start.x, target.x, ease) + jitter;
          p.py = lerp(start.y, target.y, ease) + jitter * 0.5;
          p.buildProgress = ease;
        }
        continue;
      }

      if (state === "ingreso" && p.generation === "old") {
        const center = this.getArrayCenter();
        const base = Math.min(this.width, this.height);
        const ringAngle = seededUnit(seed) * TAU + this.time * 0.02 * (p.lane % 2 === 0 ? 1 : -1);
        const ringRadius = base * (0.34 + seededUnit(seed + 5) * 0.14);
        const sway = Math.sin(this.time * 0.5 + p.drift) * base * 0.01;
        const tx = center.x + Math.cos(ringAngle) * ringRadius + sway;
        const ty = center.y + Math.sin(ringAngle) * ringRadius * 0.46 + sway * 0.5;
        p.px = lerp(p.px || tx, tx, 0.03);
        p.py = lerp(p.py || ty, ty, 0.03);
        p.buildProgress = 1;
        continue;
      }

      if (state === "ingreso" && p.generation === "new") {
        const timing = this.ingresoTiming;
        const slot = p.ingresoSlot;
        const stage = this.getIngresoStage(slot);
        const newCount = this.particles.length - this.oldCount;
        const bob = Math.sin(this.time * 1.4 + p.drift) * 1.2;

        if (this.momentTime < timing.formDuration) {
          // Formación inicial: cada fila entra horizontalmente desde su lado
          // de llegada hasta ocupar su lugar en el arreglo cuadrado.
          const formLocalStart = slot.row * timing.formRowStagger;
          const formLocalEnd = formLocalStart + timing.formSlide;
          const ease = smoothstep(formLocalStart, formLocalEnd, this.momentTime);
          p.px = lerp(stage.queueIn.x, stage.home.x, ease);
          p.py = stage.home.y + bob * (1 - ease);
          p.buildProgress = Math.max(0.12, ease);
          continue;
        }

        // Fase continua: una vez armada la figura completa, cada partícula
        // repite su propio ciclo (desfasado respecto a las demás) de modo
        // que, de a una, sale del cuadro, recorre una fila exterior por
        // fuera del arreglo y vuelve a entrar por el lado opuesto — siempre
        // en línea horizontal respecto a su fila.
        const cycleLen = newCount * timing.cycleGap;
        const holdDuration = Math.max(0.8, cycleLen - timing.transitionDuration * 2 - timing.restDuration);
        const phaseOffset = p.buildOrder * timing.cycleGap;
        const t2 = this.momentTime - timing.formDuration;
        const cyclePos = (t2 + phaseOffset) % cycleLen;

        const exitEnd = holdDuration + timing.transitionDuration;
        const restEnd = exitEnd + timing.restDuration;
        const enterEnd = restEnd + timing.transitionDuration;

        if (cyclePos < holdDuration) {
          p.px = stage.home.x;
          p.py = stage.home.y;
        } else if (cyclePos < exitEnd) {
          const ease = smoothstep(holdDuration, exitEnd, cyclePos);
          p.px = lerp(stage.home.x, stage.queueOut.x, ease);
          p.py = stage.home.y;
        } else if (cyclePos < restEnd) {
          const ease = smoothstep(exitEnd, restEnd, cyclePos);
          p.px = quadraticPoint(stage.queueOut.x, stage.arcControlX, stage.queueIn.x, ease);
          p.py = quadraticPoint(stage.queueOut.y, stage.arcControlY, stage.queueIn.y, ease);
        } else if (cyclePos < enterEnd) {
          const ease = smoothstep(restEnd, enterEnd, cyclePos);
          p.px = lerp(stage.queueIn.x, stage.home.x, ease);
          p.py = stage.home.y;
        } else {
          p.px = stage.home.x;
          p.py = stage.home.y;
        }
        p.buildProgress = 1;
        continue;
      }

      if (state === "telarana" && p.redRole === "core") {
        // Núcleo denso y lentamente orbitante: la Universidad.
        const center = this.redCenter();
        const base = Math.min(this.width, this.height);
        const orbitAngle = seededUnit(seed) * TAU + this.time * 0.05 * (p.lane % 2 === 0 ? 1 : -1);
        const orbitRadius = base * (0.03 + seededUnit(seed + 5) * 0.075);
        const tx = center.x + Math.cos(orbitAngle) * orbitRadius;
        const ty = center.y + Math.sin(orbitAngle) * orbitRadius * 0.62;
        p.px = lerp(p.px || tx, tx, 0.045);
        p.py = lerp(p.py || ty, ty, 0.045);
        continue;
      }

      if (state === "telarana" && p.redRole === "seed") {
        // Semilla de un mini cúmulo (el mundo): se posiciona en su ancla y,
        // en la fase final, es halada junto con su cúmulo hacia el centro.
        const pull = this.getTelaranaPull();
        const anchor = this.redClusterAnchor(p.redCluster, pull);
        const base = Math.min(this.width, this.height);
        const jitterAngle = seededUnit(seed + p.redSeedIndex * 13) * TAU + this.time * 0.3;
        const jitterR = base * 0.014;
        const tx = anchor.x + Math.cos(jitterAngle) * jitterR;
        const ty = anchor.y + Math.sin(jitterAngle) * jitterR * 0.6;
        p.px = lerp(p.px || tx, tx, 0.05);
        p.py = lerp(p.py || ty, ty, 0.05);
        continue;
      }

      if (state === "telarana" && p.redRole === "web") {
        // Partícula joven: espera su turno en el centro, viaja hasta su
        // cúmulo asignado tejiendo el hilo de la red, y una vez pegada se
        // mueve junto con ese cúmulo (incluida la fase final de ser halada).
        const timing = this.telaranaTiming;
        const center = this.redCenter();
        const pull = this.getTelaranaPull();
        const anchor = this.redClusterAnchor(p.redCluster, pull);
        const base = Math.min(this.width, this.height);
        const startT = timing.formDuration + p.redDepartureIndex * timing.webStagger;
        const arriveT = startT + timing.webTravel;

        if (this.momentTime < startT) {
          const orbitAngle = seededUnit(seed) * TAU + this.time * 0.08 * (p.lane % 2 === 0 ? 1 : -1);
          const orbitRadius = base * (0.02 + seededUnit(seed + 9) * 0.05);
          const tx = center.x + Math.cos(orbitAngle) * orbitRadius;
          const ty = center.y + Math.sin(orbitAngle) * orbitRadius * 0.62;
          p.px = lerp(p.px || tx, tx, 0.05);
          p.py = lerp(p.py || ty, ty, 0.05);
          p.redAttach = 0;
        } else if (this.momentTime < arriveT) {
          const ease = smoothstep(startT, arriveT, this.momentTime);
          const bow = Math.sin(ease * Math.PI) * base * 0.03 * (p.redCluster % 2 === 0 ? 1 : -1);
          const perpAngle = Math.atan2(anchor.y - center.y, anchor.x - center.x) + Math.PI / 2;
          p.px = lerp(center.x, anchor.x, ease) + Math.cos(perpAngle) * bow;
          p.py = lerp(center.y, anchor.y, ease) + Math.sin(perpAngle) * bow;
          p.redAttach = ease;
        } else {
          const jitterAngle = seededUnit(seed + 44) * TAU + this.time * 0.4;
          const jitterR = base * 0.02;
          const tx = anchor.x + Math.cos(jitterAngle) * jitterR;
          const ty = anchor.y + Math.sin(jitterAngle) * jitterR * 0.6;
          p.px = lerp(p.px || tx, tx, 0.06);
          p.py = lerp(p.py || ty, ty, 0.06);
          p.redAttach = 1;
        }
        continue;
      }

      if (state === "latent") {
        const orbit = seededUnit(seed + 2) * TAU + this.time * (0.008 + p.lane * 0.003);
        const outer = radiusBase * (2.05 + seededUnit(seed + 21) * 1.7);
        const invitation = Math.sin(this.time * 0.55 + p.drift) * radiusBase * 0.06;
        const tx = cx + Math.cos(orbit) * (outer + invitation);
        const ty = cy + Math.sin(orbit) * (outer * 0.52 + invitation * 0.5);
        p.px = lerp(p.px || tx, tx, 0.018 + stability * 0.006);
        p.py = lerp(p.py || ty, ty, 0.018 + stability * 0.006);
        continue;
      }

      if (state === "architecture") {
        const column = (p.seed % 11) / 10;
        const row = Math.floor(p.seed % 31) / 30;
        p.px = lerp(p.px || this.width * p.x, this.width * (0.52 + column * 0.32), 0.045);
        p.py = lerp(p.py || this.height * p.y, this.height * (0.22 + row * 0.48), 0.045);
        continue;
      }

      if (state === "opening") {
        const route = this.getOpeningRoute(p);
        const position = this.getOpeningPosition(route, p.drift);
        p.px = position.x;
        p.py = position.y;
        continue;
      }

      if (state === "triad" || state === "impact") {
        const isImpact = state === "impact";
        const center = this.getTriadCenter();
        const base = Math.min(this.width, this.height);
        const shapeR = base * 0.125;
        const anchors = this.getTriadAnchors(this.time);
        const anchor = anchors[p.triadGroup];

        const slotX = anchor.x + p.triadLocal.lx * shapeR;
        const slotY = anchor.y + p.triadLocal.ly * shapeR;

        const breatheX = Math.sin(this.time * 1.3 + p.drift) * (base * 0.0035);
        const breatheY = Math.cos(this.time * 1.1 + p.drift) * (base * 0.0035);

        if (!p.isCompleter) {
          p.px = lerp(p.px || slotX, slotX + breatheX, 0.055);
          p.py = lerp(p.py || slotY, slotY + breatheY, 0.055);
          p.triadAlpha = 1;
          p.isJoined = true;
          continue;
        }

        if (!isImpact) {
          const offDist = base * p.offscreenDistFactor;
          const offX = center.x + Math.cos(p.offscreenAngle) * offDist;
          const offY = center.y + Math.sin(p.offscreenAngle) * offDist;
          p.px = offX;
          p.py = offY;
          p.triadAlpha = 0;
          p.isJoined = false;
          continue;
        }

        const timing = this.triadSlide5Timing;
        const k = p.completerOrder;
        const offDist = base * p.offscreenDistFactor;
        const offX = center.x + Math.cos(p.offscreenAngle) * offDist;
        const offY = center.y + Math.sin(p.offscreenAngle) * offDist;

        const tDepart = k * timing.streamStagger;
        const tArrive = tDepart + timing.arriveTravel;
        const tGatherEnd = timing.arriveTravel + 43 * timing.streamStagger + timing.gatherHold;
        const tDisperseStart = tGatherEnd;
        const tFlightStart = tDisperseStart + (k % 15) * 0.05;
        const tFlightEnd = tFlightStart + timing.disperseTravel;

        if (this.momentTime < tDepart) {
          p.px = offX;
          p.py = offY;
          p.triadAlpha = 0;
          p.isJoined = false;
        } else if (this.momentTime < tArrive) {
          const ease = smoothstep(tDepart, tArrive, this.momentTime);
          const perpAngle = p.offscreenAngle + Math.PI / 2;
          const bow = Math.sin(ease * Math.PI) * base * 0.045 * (k % 2 === 0 ? 1 : -1);
          p.px = lerp(offX, center.x, ease) + Math.cos(perpAngle) * bow;
          p.py = lerp(offY, center.y, ease) + Math.sin(perpAngle) * bow;
          p.triadAlpha = ease;
          p.isJoined = false;
        } else if (this.momentTime < tFlightStart) {
          const swirlAngle = (k / 44) * TAU + this.time * 2.2;
          const swirlR = base * (0.012 + seededUnit(p.seed * 23 + 7) * 0.038);
          const cx_swirl = center.x + Math.cos(swirlAngle) * swirlR;
          const cy_swirl = center.y + Math.sin(swirlAngle) * swirlR * 0.65;
          p.px = lerp(p.px || cx_swirl, cx_swirl, 0.08);
          p.py = lerp(p.py || cy_swirl, cy_swirl, 0.08);
          p.triadAlpha = 1;
          p.isJoined = false;
        } else if (this.momentTime < tFlightEnd) {
          const ease = smoothstep(tFlightStart, tFlightEnd, this.momentTime);
          const perpAngle = Math.atan2(slotY - center.y, slotX - center.x) + Math.PI / 2;
          const bow = Math.sin(ease * Math.PI) * base * 0.04 * (k % 2 === 0 ? 1 : -1);
          p.px = lerp(center.x, slotX, ease) + Math.cos(perpAngle) * bow;
          p.py = lerp(center.y, slotY, ease) + Math.sin(perpAngle) * bow;
          p.triadAlpha = 1;
          p.isJoined = ease > 0.85;
        } else {
          p.px = lerp(p.px || slotX, slotX + breatheX, 0.06);
          p.py = lerp(p.py || slotY, slotY + breatheY, 0.06);
          p.triadAlpha = 1;
          p.isJoined = true;
        }
        continue;
      }

      if (state === "community") {
        const communityAngle = seededUnit(seed) * TAU + this.time * (0.08 + p.lane * 0.012);
        const ring = radiusBase * (1.08 + (p.seed % 5) * 0.18);
        const tx = cx + Math.cos(communityAngle) * ring;
        const ty = cy + Math.sin(communityAngle) * ring * 0.56;
        p.px = lerp(p.px || tx, tx, 0.05);
        p.py = lerp(p.py || ty, ty, 0.05);
        continue;
      }

      if (state === "trust") {
        const trustAngle = seededUnit(seed) * TAU + this.time * 0.045;
        const trustGrowth = smoothstep(0.4, 5.8, this.momentTime);
        const laneRadius = radiusBase * (1.18 + trustGrowth * 1.05 + p.lane * 0.34 + (p.seed % 4) * 0.08);
        const tx = cx + Math.cos(trustAngle) * laneRadius;
        const ty = cy + Math.sin(trustAngle) * laneRadius * 0.52;
        p.px = lerp(p.px || tx, tx, 0.072);
        p.py = lerp(p.py || ty, ty, 0.072);
        continue;
      }

      if (state === "routes" || state === "future") {
        const route = p.seed % 6;
        const progress = (seededUnit(seed + 6) + this.time * (state === "future" ? 0.028 : 0.022) * (1 + route * 0.08)) % 1;
        const routeAngle = seededUnit(route + this.momentHash) * TAU + route * 0.34;
        const outer = radiusBase * (state === "future" ? 4.2 : 3.3);
        const inner = radiusBase * (state === "future" ? 0.75 : 1.05);
        const startX = cx + Math.cos(routeAngle) * outer;
        const startY = cy + Math.sin(routeAngle) * outer * 0.58;
        const endX = cx + Math.cos(routeAngle + 0.9) * inner;
        const endY = cy + Math.sin(routeAngle + 0.9) * inner * 0.52;
        const controlX = cx + Math.cos(routeAngle + Math.PI * 0.5) * radiusBase * (1.6 + route * 0.08);
        const controlY = cy + Math.sin(routeAngle + Math.PI * 0.5) * radiusBase * (0.7 + route * 0.05);
        const x = quadraticPoint(startX, controlX, endX, progress);
        const y = quadraticPoint(startY, controlY, endY, progress);
        p.px = lerp(p.px || x, x, 0.06);
        p.py = lerp(p.py || y, y, 0.06);
        continue;
      }

      if (state === "duality") {
        const target = this.getDualityTarget(p);
        const follow = target.young ? 0.14 : target.hybrid ? 0.09 : 0.034;
        p.px = lerp(p.px || target.x, target.x, follow);
        p.py = lerp(p.py || target.y, target.y, follow);
        continue;
      }

      if (state === "convergence") {
        const side = p.seed % 2 === 0 ? -1 : 1;
        const merge = 0.68;
        const localCx = cx + side * this.width * (0.18 * (1 - merge));
        p.px = lerp(p.px || localCx, localCx + Math.cos(angle) * rx, 0.036 + stability * 0.016);
        p.py = lerp(p.py || cy, cy + Math.sin(angle * 1.35) * ry, 0.036 + stability * 0.016);
        continue;
      }

      if (state === "present") {
        rx *= 0.78;
        ry *= 0.78;
        const front = 1.12 + (p.seed % 4) * 0.1;
        p.px = lerp(p.px || cx, cx + Math.cos(angle) * rx * front, 0.05);
        p.py = lerp(p.py || cy, cy + Math.sin(angle * 1.18) * ry * front, 0.05);
        continue;
      }

      if (state === "qr") {
        const calmAngle = seededUnit(seed) * TAU + this.time * 0.055;
        const ring = radiusBase * (1.05 + seededUnit(seed + 12) * 1.15);
        const route = Math.sin(this.time * 0.18 + p.drift) * radiusBase * 0.16;
        const tx = cx + Math.cos(calmAngle) * (ring + route);
        const ty = cy + Math.sin(calmAngle) * (ring * 0.52 + route * 0.22);
        p.px = lerp(p.px || tx, tx, 0.045);
        p.py = lerp(p.py || ty, ty, 0.045);
        continue;
      }

      const routeX =
        Math.sin(this.time * 0.22 + seed) * this.width * 0.05 * routePull +
        (seededUnit(seed + 8) - 0.5) * this.width * 0.1 * (1 - stability);
      const routeY =
        Math.cos(this.time * 0.18 + seed * 0.6) * this.height * 0.05 * routePull;

      p.px = lerp(p.px || this.width * p.x, cx + Math.cos(angle) * rx + routeX, 0.032 + stability * 0.018);
      p.py = lerp(p.py || this.height * p.y, cy + Math.sin(angle * (1.05 + spiralPull * 0.3)) * ry + routeY, 0.032 + stability * 0.018);
    }
  }

  drawConnections(ctx) {
    const state = this.current?.state;
    if (state === "genesis") {
      this.drawGenesisConnections(ctx);
      return;
    }
    if (state === "ingreso") {
      this.drawIngresoConnections(ctx);
      return;
    }
    if (state === "telarana") {
      this.drawTelaranaWeb(ctx);
      return;
    }
    if (state === "triad" || state === "impact") {
      this.drawTriadConnections(ctx, state === "impact");
      return;
    }
    if (state === "duality") return;
    const isLatent = state === "latent";
    const distanceScale =
      {
        architecture: 0.18,
        opening: 0.22,
        triad: 0.72,
        impact: 0.78,
        community: 1.28,
        trust: 1.08,
        routes: 0.58,
        duality: 0.36,
        convergence: 1.16,
        present: 0.9,
        future: 1.32,
        qr: 1.28,
      }[state] ?? 1;
    const alphaScale =
      {
        architecture: 0.08,
        opening: 0.14,
        triad: 0.72,
        impact: 0.9,
        community: 1.55,
        trust: 1.25,
        routes: 0.62,
        duality: 0.22,
        convergence: 1.4,
        present: 1.08,
        future: 1.5,
        qr: 1.42,
      }[state] ?? 1;
    const maxDist = CONFIG.connectionDistance * (0.42 + this.params.network * 1.18) * (isLatent ? 0.56 : distanceScale);
    const boost = this.hasBackgroundAsset() ? 0.72 : 1;
    ctx.lineWidth = 1;
    for (let i = 0; i < this.particles.length; i += 1) {
      const a = this.particles[i];
      for (let j = i + 1; j < this.particles.length; j += 5) {
        const b = this.particles[j];
        if (isLatent && (a.seed + b.seed) % 11 !== 0) continue;
        if ((state === "triad" || state === "impact") && a.lane !== b.lane) continue;
        const dx = a.px - b.px;
        const dy = a.py - b.py;
        const dist = Math.hypot(dx, dy);
        if (dist < maxDist) {
          const alpha =
            (1 - dist / maxDist) *
            (0.08 + this.params.network * 0.26) *
            boost *
            (isLatent ? 0.42 : alphaScale);
          ctx.strokeStyle = rgba(this.colors[(a.lane + b.lane) % this.colors.length], alpha);
          ctx.beginPath();
          ctx.moveTo(a.px, a.py);
          ctx.lineTo(b.px, b.py);
          ctx.stroke();
        }
      }
    }
  }

  drawParticles(ctx) {
    const alphaBoost = this.hasBackgroundAsset() ? 0.82 : 1;
    const sizeBoost = this.hasBackgroundAsset() ? 0.76 : 1;
    const isLatent = this.current?.state === "latent";
    const isOpening = this.current?.state === "opening";
    const isDuality = this.current?.state === "duality";
    const isGenesis = this.current?.state === "genesis";
    const isIngreso = this.current?.state === "ingreso";
    const isTelarana = this.current?.state === "telarana";

    ctx.save();
    ctx.shadowBlur = 9;

    if (isGenesis) {
      for (const p of this.particles) {
        const progress = p.buildProgress ?? 0;
        if (progress < 0.01) continue;
        const color = p.generation === "old" ? CONFIG.palette.eventRed : CONFIG.palette.eventCyan;
        const settle = smoothstep(0.82, 1, progress);
        const pulse = 0.62 + Math.sin(this.time * 1.35 + p.drift) * 0.16 * (0.4 + progress * 0.6) + settle * 0.14;
        const alpha = Math.min(0.96, (0.22 + progress * 0.72) * alphaBoost * pulse);
        if (alpha < 0.012) continue;
        ctx.shadowColor = rgba(color, Math.min(1, alpha * 1.5));
        ctx.fillStyle = rgba(color, alpha);
        ctx.beginPath();
        ctx.arc(p.px, p.py, p.size * (0.55 + progress * 0.68) * (1 + settle * 0.32) * sizeBoost, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
      return;
    }

    if (isIngreso) {
      for (const p of this.particles) {
        const progress = p.buildProgress ?? 0;
        if (progress < 0.01) continue;
        const color = p.generation === "old" ? CONFIG.palette.eventRed : CONFIG.palette.eventCyan;
        const pulse = 0.72 + Math.sin(this.time * 1.4 + p.drift) * 0.18;
        const alpha = Math.min(0.96, 0.58 * alphaBoost * pulse);
        ctx.shadowColor = rgba(color, Math.min(1, alpha * 1.5));
        ctx.fillStyle = rgba(color, alpha);
        ctx.beginPath();
        ctx.arc(p.px, p.py, p.size * 1.08 * sizeBoost, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
      return;
    }

    if (isTelarana) {
      for (const p of this.particles) {
        if (!p.redRole) continue;
        const color = p.redRole === "web" ? CONFIG.palette.eventCyan : CONFIG.palette.eventRed;
        const attach = p.redRole === "web" ? (p.redAttach ?? 0) : 1;
        const pulse = 0.68 + Math.sin(this.time * 1.3 + p.drift) * 0.16;
        const alpha = Math.min(0.95, (0.4 + attach * 0.5) * alphaBoost * pulse);
        if (alpha < 0.012) continue;
        ctx.shadowColor = rgba(color, Math.min(1, alpha * 1.5));
        ctx.fillStyle = rgba(color, alpha);
        ctx.beginPath();
        ctx.arc(p.px, p.py, p.size * (0.7 + attach * 0.5) * sizeBoost, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
      return;
    }

    const isTriad = this.current?.state === "triad";
    const isImpact = this.current?.state === "impact";
    if (isTriad || isImpact) {
      this.drawTriadParticles(ctx, isImpact);
      return;
    }

    for (const p of this.particles) {
      const dualRole = isDuality ? this.getDualityRole(p) : null;
      const youngDual = dualRole === "young";
      const hybridDual = dualRole === "hybrid";
      const color = isDuality
        ? youngDual
          ? p.seed % 3 === 0
            ? CONFIG.palette.eventRed
            : CONFIG.palette.eventCyan
          : hybridDual
            ? p.seed % 3 === 0
              ? CONFIG.palette.eventSilver
              : p.seed % 3 === 1
                ? CONFIG.palette.eventCyan
                : CONFIG.palette.eventRed
            : CONFIG.palette.eventSilver
        : this.colors[p.lane % this.colors.length];
      const route = isOpening ? this.getOpeningRoute(p) : null;
      const openingPresence = isOpening && route.outbound ? smoothstep(2.7, 3.7, this.momentTime) : 1;
      const pulse = isLatent
        ? 0.6 + Math.max(0, Math.sin(this.time * 1.15 + p.drift)) * 0.62
        : isOpening
          ? 0.8 + Math.sin(this.time * 0.7 + p.drift) * 0.16
          : isDuality
            ? youngDual
              ? 0.78 + Math.sin(this.time * 2.2 + p.drift) * 0.28
              : hybridDual
                ? 0.86 + Math.sin(this.time * 1.25 + p.drift) * 0.18
                : 0.82 + Math.sin(this.time * 0.48 + p.drift) * 0.09
          : 0.72 + Math.sin(this.time * 1.8 + p.drift) * 0.28;
      const alpha = Math.min(
        0.94,
        (0.52 + this.params.intensity * 0.42) *
          alphaBoost *
          (isLatent ? 0.86 : 1) *
          openingPresence *
          (isDuality && youngDual ? 1.14 : isDuality && hybridDual ? 1.12 : isDuality ? 0.82 : 1),
      );
      if (alpha < 0.01) continue;
      ctx.shadowColor = rgba(color, Math.min(1, alpha * 1.4));
      ctx.fillStyle = rgba(color, alpha);
      ctx.beginPath();
      ctx.arc(
        p.px,
        p.py,
        p.size *
          pulse *
          (1 + this.params.intensity * 0.62) *
          sizeBoost *
          (isLatent ? 0.86 : 1) *
          (isDuality && youngDual ? 1.34 : isDuality && hybridDual ? 1.32 : isDuality ? 1.08 : 1),
        0,
        TAU,
      );
      ctx.fill();
    }
    ctx.restore();
  }

  drawSpiral(ctx) {
    if (
      this.current?.state === "genesis" ||
      this.current?.state === "ingreso" ||
      this.current?.state === "telarana" ||
      this.current?.state === "triad" ||
      this.current?.state === "impact"
    )
      return;
    const cx = this.width * 0.66;
    const cy = this.height * 0.47;
    const isOpening = this.current?.state === "opening";
    const motionScale = isOpening ? 0.38 : 1;
    const turns = 4.8 + this.params.spiral * 3.4;
    const points = 340;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const boost = this.hasBackgroundAsset() ? 1.34 : 1;
    for (let lane = 0; lane < 3; lane += 1) {
      ctx.beginPath();
      for (let i = 0; i < points; i += 1) {
        const t = i / (points - 1);
        const angle = t * TAU * turns + this.time * (0.18 + lane * 0.025) * motionScale;
        const radius = t * Math.min(this.width, this.height) * (0.18 + this.params.spiral * 0.26);
        const wobble = Math.sin(t * 18 + this.time * 0.8 * motionScale + lane) * 10 * this.params.intensity;
        const x = cx + Math.cos(angle) * (radius + wobble);
        const y = cy + Math.sin(angle) * (radius * 0.58 + wobble * 0.24);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(this.colors[lane], (0.08 + this.params.spiral * 0.16) * boost);
      ctx.lineWidth = (1.2 + lane * 0.45) * boost;
      ctx.stroke();
    }
    const coreColors = [CONFIG.palette.eventRed, CONFIG.palette.eventMagenta, CONFIG.palette.eventCyan];
    for (let lane = 0; lane < 3; lane += 1) {
      ctx.beginPath();
      const offset = (lane / 3) * TAU + this.time * 0.25 * motionScale;
      for (let i = 0; i < 96; i += 1) {
        const t = i / 95;
        const angle = offset + t * TAU * 0.82;
        const radius = Math.min(this.width, this.height) * (0.03 + t * 0.16);
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius * 0.68;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(coreColors[lane], (0.08 + this.params.spiral * 0.12) * boost);
      ctx.lineWidth = (5.2 - lane * 0.9) * boost;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawArchitecture(ctx) {
    return;
  }

  drawArchive(ctx) {
    const state = this.current?.state;
    if (state !== "architecture") return;
    const amount = this.params.archive;
    if (amount < 0.04) return;
    ctx.save();
    ctx.globalAlpha = amount * 0.82;
    for (let i = 0; i < 5; i += 1) {
      const seed = this.momentHash + i * 23;
      const x = this.width * (0.56 + seededUnit(seed) * 0.34);
      const y = this.height * (0.18 + seededUnit(seed + 1) * 0.55);
      const w = this.width * (0.08 + seededUnit(seed + 2) * 0.08);
      const h = w * (0.58 + seededUnit(seed + 3) * 0.28);
      ctx.strokeStyle = rgba(this.colors[i % this.colors.length], 0.18);
      ctx.fillStyle = rgba(CONFIG.palette.ink, 0.035);
      ctx.lineWidth = 1;
      ctx.translate(0, Math.sin(this.time * 0.35 + i) * 2);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.beginPath();
      ctx.moveTo(x + w * 0.18, y + h * 0.66);
      ctx.lineTo(x + w * 0.4, y + h * 0.42);
      ctx.lineTo(x + w * 0.62, y + h * 0.56);
      ctx.lineTo(x + w * 0.84, y + h * 0.28);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawStateGesture(ctx) {
    const state = this.current?.state;
    if (state === "opening") {
      this.drawOpeningEncounter(ctx);
    }
    if (state === "duality") {
      this.drawDualityForeground(ctx);
    }
    if (state === "community") {
      this.drawMatureBonds(ctx, 0.82);
    }
    if (state === "future") {
      this.drawLivingRoutes(ctx, 1.1, 0.96);
      this.drawMatureBonds(ctx, 1.12);
    }
    if (state === "routes") {
      this.drawLivingRoutes(ctx, 1, 0.72);
    }
    if (state === "trust") {
      this.drawTrustGrowth(ctx);
    }
    if (state === "present") {
      this.drawYouthReveal(ctx);
    }
    if (state === "qr") {
      this.drawLivingRoutes(ctx, 0.94, 0.82);
      this.drawMatureBonds(ctx, 1.18);
    }
  }

  drawOpeningEncounter(ctx) {
    const cx = this.width * 0.64;
    const cy = this.height * 0.46;
    const base = Math.min(this.width, this.height);
    const meetingGlow = smoothstep(5.8, 7, this.momentTime) * (1 - smoothstep(8.2, 9.6, this.momentTime));
    const finalPull = smoothstep(8.4, 15.2, this.momentTime);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 1.2;

    for (let i = 0; i < 12; i += 1) {
      const p = this.particles[(i * 11) % this.particles.length];
      const route = this.getOpeningRoute(p);
      const position = this.getOpeningPosition(route, p.drift);
      const firstProgress = route.outbound ? position.outboundProgress : position.inboundProgress;
      const routeAlpha = (route.outbound ? 0.018 + firstProgress * 0.07 : 0.045 + firstProgress * 0.08) * (1 - finalPull * 0.35);
      const color = this.colors[i % this.colors.length];
      const startX = route.outbound ? route.coreX : route.farX;
      const startY = route.outbound ? route.coreY : route.farY;
      const controlX = route.outbound ? route.outboundControlX : route.inboundControlX;
      const controlY = route.outbound ? route.outboundControlY : route.inboundControlY;

      ctx.beginPath();
      for (let j = 0; j <= 30; j += 1) {
        const t = j / 30;
        const x = quadraticPoint(startX, controlX, route.encounterX, t);
        const y = quadraticPoint(startY, controlY, route.encounterY, t);
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(color, routeAlpha * this.params.intensity);
      ctx.stroke();

      ctx.beginPath();
      for (let j = 0; j <= 24; j += 1) {
        const t = j / 24;
        const x = quadraticPoint(route.encounterX, route.finalControlX, route.finalX, t);
        const y = quadraticPoint(route.encounterY, route.finalControlY, route.finalY, t);
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(color, (0.026 + finalPull * 0.07) * this.params.intensity);
      ctx.stroke();

      const beadAlpha = route.outbound ? smoothstep(2.7, 3.7, this.momentTime) : 1;
      ctx.fillStyle = rgba(color, (0.16 + this.params.intensity * 0.18) * beadAlpha);
      ctx.beginPath();
      ctx.arc(position.x, position.y, 2 + this.params.intensity * 1.7, 0, TAU);
      ctx.fill();
    }

    ctx.strokeStyle = rgba(CONFIG.palette.eventSilver, 0.08 + meetingGlow * 0.22);
    ctx.lineWidth = 1.4 + meetingGlow * 1.2;
    ctx.beginPath();
    ctx.ellipse(cx - base * 0.14, cy, base * (0.025 + meetingGlow * 0.035), base * (0.012 + meetingGlow * 0.02), 0, 0, TAU);
    ctx.stroke();

    for (let i = 0; i < 3; i += 1) {
      const phase = (this.momentTime * 0.045 + i / 3) % 1;
      ctx.strokeStyle = rgba(this.colors[i], (1 - phase) * (0.07 + finalPull * 0.09) * this.params.intensity);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, base * (0.08 + phase * 0.12), base * (0.04 + phase * 0.065), 0, 0, TAU);
      ctx.stroke();
    }

    ctx.restore();
  }

  drawImpactRings(ctx, scale) {
    const cx = this.width * 0.68;
    const cy = this.height * 0.48;
    ctx.save();
    for (let i = 0; i < 7; i += 1) {
      const phase = (this.time * 0.18 + i / 7) % 1;
      const r = phase * Math.min(this.width, this.height) * 0.62 * scale;
      ctx.strokeStyle = rgba(this.colors[i % this.colors.length], (1 - phase) * 0.16 * this.params.intensity);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.58, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawCommunityPulse(ctx) {
    const cx = this.width * 0.66;
    const cy = this.height * 0.47;
    const base = Math.min(this.width, this.height);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 4; i += 1) {
      const phase = (this.time * 0.12 + i / 4) % 1;
      ctx.strokeStyle = rgba(this.colors[i % this.colors.length], (1 - phase) * 0.12);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(cx, cy, base * (0.16 + phase * 0.24), base * (0.08 + phase * 0.13), 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawRoutes(ctx, scale = 1) {
    ctx.save();
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 9; i += 1) {
      const y = this.height * (0.22 + i * 0.064);
      const startX = this.width * (0.48 + seededUnit(i + 44) * 0.12);
      ctx.beginPath();
      for (let j = 0; j < 7; j += 1) {
        const x = startX + j * this.width * 0.065;
        const yy = y + Math.sin(this.time * 0.9 + i + j * 0.7) * this.height * 0.018;
        if (j === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.strokeStyle = rgba(this.colors[i % 3], (0.08 + this.params.intensity * 0.1) * scale);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawTrustGrowth(ctx) {
    this.drawMatureBonds(ctx, 1.28);
  }

  drawYouthReveal(ctx) {
    const cx = this.width * 0.66;
    const cy = this.height * 0.47;
    const base = Math.min(this.width, this.height);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * 0.36);
    glow.addColorStop(0, rgba(CONFIG.palette.eventRed, 0.16));
    glow.addColorStop(0.45, rgba(CONFIG.palette.eventCyan, 0.08));
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - base * 0.36, cy - base * 0.36, base * 0.72, base * 0.72);

    for (let i = 0; i < 16; i += 1) {
      const p = this.particles[(i * 5 + 1) % this.particles.length];
      const color = i % 2 === 0 ? CONFIG.palette.eventCyan : CONFIG.palette.eventRed;
      ctx.strokeStyle = rgba(color, 0.12 + this.params.intensity * 0.12);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo((cx + p.px) * 0.5, cy - base * 0.08, p.px, p.py);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawConstructionLattice(ctx) {
    const cx = this.width * 0.66;
    const cy = this.height * 0.48;
    const base = Math.min(this.width, this.height);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = rgba(CONFIG.palette.eventSilver, 0.1);
    ctx.lineWidth = 1;
    for (let i = -4; i <= 4; i += 1) {
      const x = cx + i * base * 0.07;
      ctx.beginPath();
      ctx.moveTo(x - base * 0.22, cy + base * 0.22);
      ctx.lineTo(x + base * 0.18, cy - base * 0.18);
      ctx.stroke();
    }
    for (let i = -3; i <= 3; i += 1) {
      const y = cy + i * base * 0.045;
      ctx.beginPath();
      ctx.moveTo(cx - base * 0.34, y);
      ctx.lineTo(cx + base * 0.36, y + base * 0.08);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawContinuityHalo(ctx) {
    const cx = this.width * 0.76;
    const cy = this.height * 0.52;
    const base = Math.min(this.width, this.height);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i += 1) {
      ctx.strokeStyle = rgba(this.colors[i], 0.08);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, base * (0.18 + i * 0.07), base * (0.08 + i * 0.035), 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }
}

window.VisualSystem = VisualSystem;
