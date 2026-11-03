import { Container, Graphics, Application, Assets, Sprite, Texture, BufferImageSource } from 'pixi.js';

import config from "./config.js";

function colourStringToRGB(colour_str) {
  return [parseInt(colour_str.substring(1, 3), 16),
          parseInt(colour_str.substring(3, 5), 16),
          parseInt(colour_str.substring(5, 7), 16)];
}

function getColor(prob, colour_low, colour_high) {
  // Takes a probability (number from 0 to 1) and converts it into a color code
  const lo = colourStringToRGB(colour_low);
  const hi = colourStringToRGB(colour_high);
  const hex = (x) => x.toString(16).padStart(2, '0');
  const mix = (i) => Math.round(hi[i] * prob + lo[i] * (1 - prob));
  return "#" + hex(mix(0)) + hex(mix(1)) + hex(mix(2));
}

// Packs an RGB triple into a little-endian RGBA Uint32 (bytes in memory: R, G, B, A).
function packRGBA(rgb) {
  return (rgb[0] | (rgb[1] << 8) | (rgb[2] << 16) | (0xff << 24)) >>> 0;
}

/**
 * Builds a 256-entry lookup table from a ROS occupancy value (int8, indexed
 * by `value & 0xFF`) to a packed RGBA colour.
 *   0..100  -> linear ramp from free colour to occupied colour.
 *   101..127 -> occupied colour.
 *   negative (incl. -1) -> unknown colour.
 */
function buildColourLUT(freeColour, occupiedColour, unknownColour) {
  const lut = new Uint32Array(256);
  const unknown = packRGBA(colourStringToRGB(unknownColour));
  for (let i = 0; i < 256; i++) {
    if (i >= 128) {
      lut[i] = unknown;
    } else {
      const p = Math.min(i, 100) / 100;
      lut[i] = packRGBA(colourStringToRGB(getColor(p, freeColour, occupiedColour)));
    }
  }
  return lut;
}

// Max texture edge length per tile. 2048 is supported by effectively every GPU.
const TILE_SIZE = 2048;

/**
 * Renders a ROS OccupancyGrid as a set of nearest-neighbour textures in world
 * coordinates (meters). Lives inside a y-up world container, so texel row 0
 * (the ROS bottom row) naturally renders at the bottom.
 */
class OccupancyGrid {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.metersPerCell = 0.05;
    this.origin = [0, 0];
    this.cells = null;  // The latest raw cell data (array or typed array).

    this.lut = buildColourLUT(config.MAP_COLOUR_LOW, config.MAP_COLOUR_HIGH, config.MAP_COLOUR_UNKNOWN);
    this.container = new Container();
    this.tiles = [];  // {x0, y0, w, h, pixels (Uint32Array), source, sprite}
  }

  posToCell(x, y) {
    const col = Math.floor((x - this.origin[0]) / this.metersPerCell);
    const row = Math.floor((y - this.origin[1]) / this.metersPerCell);
    return [row, col];
  }

  cellToPos(r, c) {
    // Returns the world position of the bottom-left corner of the cell.
    return [this.origin[0] + c * this.metersPerCell, this.origin[1] + r * this.metersPerCell];
  }

  // World-frame bounds of the map: [xmin, ymin, xmax, ymax].
  bounds() {
    return [this.origin[0], this.origin[1],
            this.origin[0] + this.width * this.metersPerCell,
            this.origin[1] + this.height * this.metersPerCell];
  }

  isLoaded() {
    return this.cells !== null;
  }

  destroyTiles() {
    for (const t of this.tiles) {
      t.sprite.destroy();
      t.texture.destroy(true);
    }
    this.tiles = [];
    this.container.removeChildren();
  }

  allocateTiles() {
    this.destroyTiles();
    for (let y0 = 0; y0 < this.height; y0 += TILE_SIZE) {
      for (let x0 = 0; x0 < this.width; x0 += TILE_SIZE) {
        const w = Math.min(TILE_SIZE, this.width - x0);
        const h = Math.min(TILE_SIZE, this.height - y0);
        const bytes = new Uint8Array(w * h * 4);
        const source = new BufferImageSource({
          resource: bytes, width: w, height: h,
          format: 'rgba8unorm', scaleMode: 'nearest', autoGenerateMipmaps: false,
        });
        const texture = new Texture({ source });
        const sprite = new Sprite(texture);
        sprite.position.set(x0, y0);  // In cell units; container is scaled to meters.
        this.container.addChild(sprite);
        this.tiles.push({ x0, y0, w, h, pixels: new Uint32Array(bytes.buffer), source, texture, sprite });
      }
    }
  }

  /**
   * Updates the map. Only reallocates GPU textures if the dimensions change;
   * origin or resolution changes just move / rescale the container.
   */
  update(width, height, metersPerCell, origin, cells) {
    if (cells.length !== width * height) {
      console.warn(`Map data size mismatch: ${cells.length} != ${width * height}`);
      return;
    }

    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.allocateTiles();
    }
    this.metersPerCell = metersPerCell;
    this.origin = [origin[0], origin[1]];
    this.container.position.set(origin[0], origin[1]);
    this.container.scale.set(metersPerCell);
    this.cells = cells;

    const lut = this.lut;
    for (const t of this.tiles) {
      const px = t.pixels;
      let o = 0;
      for (let r = 0; r < t.h; r++) {
        let i = (t.y0 + r) * width + t.x0;
        const end = i + t.w;
        for (; i < end; i++) px[o++] = lut[cells[i] & 0xff];
      }
      t.source.update();
    }
  }

  clear() {
    this.destroyTiles();
    this.width = 0;
    this.height = 0;
    this.cells = null;
  }

  getMapData() {
    if (!this.isLoaded()) return null;
    return {
      cells: this.cells,
      width: this.width,
      height: this.height,
      origin: this.origin,
      metersPerCell: this.metersPerCell,
    };
  }
}


/**
 * The scene is drawn in world coordinates (meters, y up). The `world`
 * container's transform maps world -> screen pixels:
 *   screen = (world.x + s * x, world.y - s * y), where s = world.scale.x.
 */
class MBotScene {
  constructor() {
    this.app = null;
    this.robotState = {x: 0, y: 0, theta: 0};
    this.occupancyGrid = new OccupancyGrid();

    // Default view bounds if no map is loaded: 5m x 5m centred on the origin.
    this.defaultBounds = [-2.5, -2.5, 2.5, 2.5];
    this.needsFit = true;  // Fit the view to the map on the next map update.

    this.lastPath = null;
    this.clickedPos = null;

    this.dragStart = null;
    this.clickStart = null;
    this.clickCallback = (pos) => {};

    this.stopped = false;
    this.loaded = false;
  }

  async init() {
    if (this.stopped) throw new Error("Initialization aborted because destroy was called.");
    if (this.loaded || this.app) throw new Error("App is already initialized or initialization was already called.");

    this.app = new Application();
    this.loaded = false;
    await this.app.init({ resizeTo: window, backgroundColor: 0xc9d1d9 });

    const imgUrl = new URL('./images/mbot.png', import.meta.url).href;
    this.robotImage = await Assets.load(imgUrl);

    if (this.stopped) {
      this.app.destroy(true, true);
      throw new Error("Initialization aborted because destroy was called.");
    }
  }

  destroy() {
    if (this.app && this.loaded) {
      this.app.destroy(true, true);
      this.loaded = false;
    }
    this.stopped = true;
  }

  get scale() {
    return this.world ? this.world.scale.x : 1;
  }

  // Converts a length in screen pixels to meters at the current zoom.
  pxToM(px) {
    return px / this.scale;
  }

  createScene(ele) {
    this.app.resizeTo = ele;
    ele.appendChild(this.app.canvas);

    // World container: meters, y up.
    this.world = new Container();
    this.app.stage.addChild(this.world);

    this.world.addChild(this.occupancyGrid.container);

    this.particlesGraphics = new Graphics();
    this.world.addChild(this.particlesGraphics);

    this.pathGraphics = new Graphics();
    this.world.addChild(this.pathGraphics);

    this.clickedCellGraphics = new Graphics();
    this.world.addChild(this.clickedCellGraphics);

    // Robot container, in the robot frame.
    this.robotContainer = new Container();
    this.laserGraphics = new Graphics();
    this.robotContainer.addChild(this.laserGraphics);

    this.robot = new Sprite(this.robotImage);
    this.robot.anchor.set(0.5);
    // Size in meters; negative y scale undoes the world y-flip so the image isn't mirrored.
    const s = config.ROBOT_SIZE / this.robotImage.width;
    this.robot.scale.set(s, -s);
    this.robotContainer.addChild(this.robot);
    this.world.addChild(this.robotContainer);

    this.fitView(this.defaultBounds);

    // Interaction: the whole stage is the hit area so you can drag anywhere.
    const stage = this.app.stage;
    stage.eventMode = 'static';
    stage.hitArea = this.app.screen;

    stage.on('pointerdown', (event) => {
      this.dragStart = { x: event.global.x, y: event.global.y };
      this.clickStart = { x: event.global.x, y: event.global.y };
    });

    stage.on('pointerup', (event) => {
      if (this.clickStart &&
          Math.abs(this.clickStart.x - event.global.x) < 2 &&
          Math.abs(this.clickStart.y - event.global.y) < 2) {
        const pos = this.screenToWorld(this.clickStart.x, this.clickStart.y);
        this.drawClickedCell(pos[0], pos[1]);
        this.clickCallback(pos);
      }
      this.dragStart = null;
      this.clickStart = null;
      this.constrainView();
    });

    stage.on('pointerupoutside', () => {
      this.dragStart = null;
      this.clickStart = null;
      this.constrainView();
    });

    stage.on('pointermove', (event) => {
      if (!this.dragStart) return;
      this.world.x += event.global.x - this.dragStart.x;
      this.world.y += event.global.y - this.dragStart.y;
      this.dragStart = { x: event.global.x, y: event.global.y };
    });

    this.app.canvas.addEventListener('wheel', (event) => { this.zoomHandler(event); }, { passive: false });

    this.loaded = true;
  }

  screenToWorld(u, v) {
    const s = this.scale;
    return [(u - this.world.x) / s, -(v - this.world.y) / s];
  }

  setView(s, x, y) {
    this.world.scale.set(s, -s);
    this.world.position.set(x, y);
    this.redrawZoomDependent();
  }

  // Sets the view so the given world bounds fill the screen.
  fitView(bounds) {
    const [xmin, ymin, xmax, ymax] = bounds;
    const W = this.app.screen.width, H = this.app.screen.height;
    const s = Math.min(W / (xmax - xmin), H / (ymax - ymin)) * 0.95;
    const cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2;
    this.setView(s, W / 2 - s * cx, H / 2 + s * cy);
  }

  viewBounds() {
    return this.occupancyGrid.isLoaded() ? this.occupancyGrid.bounds() : this.defaultBounds;
  }

  zoomHandler(event) {
    event.preventDefault();
    const [xmin, ymin, xmax, ymax] = this.viewBounds();
    const W = this.app.screen.width, H = this.app.screen.height;
    // Zoom out until the map is half the screen; zoom in until a 1cm square is ~40px.
    const minScale = 0.5 * Math.min(W / (xmax - xmin), H / (ymax - ymin));
    const maxScale = 4000;

    const direction = event.deltaY > 0 ? -1 : 1;
    const s = this.scale;
    const s2 = Math.min(maxScale, Math.max(minScale, s * Math.pow(1.1, direction)));
    if (s2 === s) return;

    // Keep the world point under the cursor fixed.
    const cx = event.offsetX, cy = event.offsetY;
    const [wx, wy] = this.screenToWorld(cx, cy);
    this.setView(s2, cx - s2 * wx, cy + s2 * wy);
    this.constrainView();
  }

  // Keep the centre of the screen within the map bounds so the map can't be lost.
  constrainView() {
    const [xmin, ymin, xmax, ymax] = this.viewBounds();
    const W = this.app.screen.width, H = this.app.screen.height;
    const s = this.scale;
    const [cx, cy] = this.screenToWorld(W / 2, H / 2);
    const nx = Math.min(xmax, Math.max(xmin, cx));
    const ny = Math.min(ymax, Math.max(ymin, cy));
    if (nx !== cx || ny !== cy) {
      this.world.position.set(W / 2 - s * nx, H / 2 + s * ny);
    }
  }

  // Re-stroke things whose line widths are specified in screen pixels.
  redrawZoomDependent() {
    if (this.lastPath) this.drawPath(this.lastPath);
  }

  updateMap(width, height, metersPerCell, origin, cells) {
    this.occupancyGrid.update(width, height, metersPerCell, origin, cells);
    if (this.needsFit && this.occupancyGrid.isLoaded()) {
      this.fitView(this.occupancyGrid.bounds());
      this.needsFit = false;
    }
  }

  getMapData() {
    return this.occupancyGrid.getMapData();
  }

  isMapLoaded() {
    return this.occupancyGrid.isLoaded();
  }

  posToCell(x, y) {
    return this.occupancyGrid.posToCell(x, y);
  }

  clear() {
    this.occupancyGrid.clear();
    this.needsFit = true;
    this.clearPath();
    this.clearParticles();
    this.clickedCellGraphics.clear();
    this.clickedPos = null;
  }

  updateRobot(x, y, theta = 0) {
    this.robotContainer.position.set(x, y);
    this.robotContainer.rotation = theta;  // World is y-up, so positive is CCW.
    this.robotState.x = x;
    this.robotState.y = y;
    this.robotState.theta = theta;
  }

  toggleRobotView(visible) {
    this.robot.visible = visible;
  }

  drawLasers(ranges, thetas, color = "green", line_width = 1) {
    this.laserGraphics.clear();
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (!Number.isFinite(r)) continue;
      this.laserGraphics.moveTo(0, 0);
      this.laserGraphics.lineTo(r * Math.cos(thetas[i]), r * Math.sin(thetas[i]));
    }
    this.laserGraphics.stroke({ width: line_width, color: color, pixelLine: line_width <= 1 });
  }

  clearLasers() {
    if (this.laserGraphics) this.laserGraphics.clear();
  }

  drawPath(path, color = config.PATH_COLOUR, line_width = 2) {
    this.pathGraphics.clear();
    this.lastPath = path;
    if (path.length === 0) return;

    this.pathGraphics.moveTo(path[0][0], path[0][1]);
    for (let i = 1; i < path.length; i++) {
      this.pathGraphics.lineTo(path[i][0], path[i][1]);
    }
    this.pathGraphics.stroke({ width: this.pxToM(line_width), color: color });
  }

  clearPath() {
    this.lastPath = null;
    if (this.pathGraphics) this.pathGraphics.clear();
  }

  // Particles are given in world coordinates; size is in map cells.
  drawParticles(particles, color = 0xff0000, size = 1) {
    this.particlesGraphics.clear();
    const radius = size * this.occupancyGrid.metersPerCell;
    for (let i = 0; i < particles.length; i++) {
      this.particlesGraphics.circle(particles[i][0], particles[i][1], radius);
    }
    this.particlesGraphics.fill(color);
  }

  clearParticles() {
    if (this.particlesGraphics) this.particlesGraphics.clear();
  }

  drawClickedCell(x, y) {
    this.clickedCellGraphics.clear();
    if (!this.isMapLoaded()) return;
    const [r, c] = this.posToCell(x, y);
    const [cx, cy] = this.occupancyGrid.cellToPos(r, c);
    const m = this.occupancyGrid.metersPerCell;
    this.clickedCellGraphics.rect(cx, cy, m, m).fill(0xff8300);
    this.clickedPos = [x, y];
  }

  clearClickedCell() {
    this.clickedCellGraphics.clear();
    this.clickedPos = null;
    this.clickCallback([]);
  }
}

export { colourStringToRGB, getColor, MBotScene };
