import * as fs from 'fs';
import * as path from 'path';

import * as colorString from 'color-string';
import * as paper from 'paper';
import * as xml2js from 'xml2js';
import * as xmlbuilder from 'xmlbuilder';

import { absolute, draw, overlaps, extract, sanitize } from './utils';
import { Def, Doc, DocRoot, Drawable, Elem, Path } from './types';

const colrDir = process.argv[2];
const monoDir = process.argv[3];
const extrasDir = process.argv[4];
const targetDir = process.argv[5];
const fontName = process.argv[6];

if (fontName === undefined) {
  console.error('### Missing font name.');
  console.error(
    '### Usage: node ' +
      process.argv[1] +
      ' source-SVGs.zip overrides-dir extras-dir build-dir font-name'
  );
  throw 'fontName';
}

// Extra ligature rules to support ZWJ sequences that already exist as individual characters
const extraLigas: LigaEntry[] = JSON.parse(
  fs.readFileSync(extrasDir + '/ligatures.json').toString()
);

// glyph name -> data
const cmpt_map = new Map<string, string>();
// glyph name -> svg node attr
const cmpt_meta = new Map<string, { [index: string]: string }>();
// glyph name
const cmpt_shared = new Set<string>();
// normalized hex -> id
const colr_list: string[] = [];

type CmptEntry = { name: string; color: number };
type CharEntry = {
  codepoint: string;
  components: CmptEntry[];
};
type LigaEntry = {
  codepoint: string[];
  components: CmptEntry[];
};

const chars: CharEntry[] = [];
const ligas: LigaEntry[] = [];
const grunt_data = [];

paper.setup(new paper.Size(2048, 2048));

const scaler = (() => {
  const target = 2048;
  const bleeding = 128;
  const descender = -214;

  // workaround for arc flags parsing errors
  const fix = function (elem: Path) {
    elem.$.d = elem.$.d.replace(
      /(?<=[Aa] *)(?:(?:-?[\d]+(?:\.\d+)?|-?\.\d+),? *)+/g,
      (match) =>
        match
          .replace(
            /(-?[\d]+(?:\.\d+)?|-?\.\d+),? *(-?[\d]+(?:\.\d+)?|-?\.\d+)[ ,](0|1),? *(0|1),? *(0|1),? *(-?[\d]+(?:\.\d+)?|-?\.\d+),? *(-?[\d]+(?:\.\d+)?|-?\.\d+),? */g,
            '$1,$2 $3 $4 $5 $6,$7 '
          )
          .trim()
    );
    return elem;
  };

  return {
    matrix: function (width: number, height: number) {
      const factorC = target / height;
      const factorD = (target + bleeding * 2) / height;
      const offsetX = ((factorC - factorD) / 2) * width;
      const offsetY = ((factorC - factorD) / 2) * height + descender / 2;
      const T = new paper.Matrix(factorD, 0, 0, factorD, offsetX, offsetY);
      return T;
    },

    drawable: function (doc: Doc, elems: Drawable[]) {
      let height: number = undefined;
      let width: number = undefined;
      let factorC: number = undefined;
      if (doc.$['height']) {
        height = parseFloat(doc.$.height);
        factorC = target / height;
        doc.$.height = target.toString();
      }
      if (doc.$['viewBox']) {
        const nums = doc.$.viewBox.split(' ').map((s) => parseFloat(s));
        width = nums[2];
        height = nums[3];
        factorC = target / height;
        doc.$.viewBox = nums.map((n) => (n * factorC).toString()).join(' ');
      }
      if (factorC === undefined) {
        throw doc;
      }
      if (doc.$['width']) {
        width = parseFloat(doc.$.width);
        doc.$.width = (factorC * width).toString();
      }

      const factorD = (target + bleeding * 2) / height;
      const offsetX = (-bleeding * width) / height;
      const offsetY = -bleeding + descender / 2;
      const T = new paper.Matrix(factorD, 0, 0, factorD, offsetX, offsetY);

      const transformRel = (s: string) => parseFloat(s) * factorD;
      const transformAbsX = (s: string) => parseFloat(s) * factorD + offsetX;
      const transformAbsY = (s: string) => parseFloat(s) * factorD + offsetY;

      elems.map((elem) => {
        absolute(elem, width, height);
        switch (elem['#name']) {
          case 'path':
            const path = draw(fix(elem));
            path.transform(T);
            elem.$.d = path.pathData;
            path.remove();
            return;
          case 'polygon':
          case 'polyline':
            elem.$.points = elem.$.points
              .replace(
                /(-?[\d]+(?:\.\d+)?|-?\.\d+),? *(-?[\d]+(?:\.\d+)?|-?\.\d+),? */g,
                (_, x: string, y: string) =>
                  `${transformAbsX(x)},${transformAbsY(y)} `
              )
              .trimEnd();
            return;
          case 'circle':
            if (elem.$['r']) elem.$.r = transformRel(elem.$.r).toString();
          case 'ellipse':
            if (elem.$['cx']) elem.$.cx = transformAbsX(elem.$.cx).toString();
            if (elem.$['cy']) elem.$.cy = transformAbsY(elem.$.cy).toString();
            if (elem['#name'] == 'circle') return;
          case 'rect':
            if (elem.$['rx']) elem.$.rx = transformRel(elem.$.rx).toString();
            if (elem.$['ry']) elem.$.ry = transformRel(elem.$.ry).toString();
            if (elem['#name'] == 'ellipse') return;
            if (elem.$['x']) elem.$.x = transformAbsX(elem.$.x).toString();
            if (elem.$['y']) elem.$.y = transformAbsY(elem.$.y).toString();
            if (elem.$['width'])
              elem.$.width = transformRel(elem.$.width).toString();
            if (elem.$['height'])
              elem.$.height = transformRel(elem.$.height).toString();
            return;
          case 'line':
            if (elem.$['x1']) elem.$.x1 = transformAbsX(elem.$.x1).toString();
            if (elem.$['x2']) elem.$.y1 = transformAbsY(elem.$.y1).toString();
            if (elem.$['y1']) elem.$.x2 = transformAbsX(elem.$.x2).toString();
            if (elem.$['y2']) elem.$.y2 = transformAbsY(elem.$.y2).toString();
            return;
          default:
            throw elem;
        }
      });
    },
  };
})();

const parser = (() => {
  const cmpt_rmap: Map<string, string> = new Map<string, string>();
  const colr_rmap: Map<string, number> = new Map<string, number>();

  function normalizeColor(c: string) {
    if (c === undefined || c === null) {
      return undefined;
    }
    c = c.toLowerCase().trim();
    if (c === 'none') {
      return c;
    }
    c = colorString.to.hex(colorString.get(c).value).toLowerCase();
    return c.length == 7 ? `${c}ff` : c;
  }

  function applyOpacity(c: string, o: number) {
    if (c === undefined || c === 'none') {
      return c;
    }
    const color = colorString.get(c).value;
    return colorString.to
      .hex([color[0], color[1], color[2], color[3] * o])
      .toLowerCase();
  }

  function registerGradient(elem: Def, colors: { [index: string]: string }) {
    const stops = [];
    const id = '#' + elem.$['id'];
    elem['$$'].forEach(function (child) {
      if (child['#name'] === 'stop') {
        stops.push(normalizeColor(child.$['stop-color']));
      }
    });
    const stopCount = stops.length;
    let r = 0,
      g = 0,
      b = 0;
    if (stopCount > 0) {
      stops.forEach(function (stop) {
        r = r + parseInt(stop.substr(1, 2), 16);
        g = g + parseInt(stop.substr(3, 2), 16);
        b = b + parseInt(stop.substr(5, 2), 16);
      });
      r = Math.round(r / stopCount);
      g = Math.round(g / stopCount);
      b = Math.round(b / stopCount);
    }
    colors[id] = `#${colorString.to.hex([r, g, b]).toLowerCase()}ff`;
  }

  return {
    clear: function () {
      cmpt_rmap.clear();
      colr_rmap.clear();
    },
    process: function (fileName: string, data: string | Buffer) {
      // strip .svg extension off the name
      const name = fileName.replace(/\.svg$/, '');

      const parser = new xml2js.Parser({
        preserveChildrenOrder: true,
        explicitChildren: true,
        explicitArray: true,
      });

      // Save the original file also for visual comparison
      fs.writeFileSync(targetDir + '/colorGlyphs/u' + name + '.svg', data);

      const codepoints = name.split('-').map((x) => x.toLowerCase());

      parser.parseString(data, function (_, doc: DocRoot) {
        const layers: { shape: Drawable; color: string }[] = [];
        const defs = {};
        const defColors = {};

        const parseElements = function (
          parentFill: string | null,
          parentStroke: string | null,
          parentOpacity: number | null,
          parentStrokeWidth: string | null,
          parentTransform: string | null,
          elems: Elem[]
        ) {
          elems.forEach((e) => {
            switch (e['#name']) {
              case 'metadata':
                e = undefined;
                return;
              case 'defs':
                if (e['$$'] === undefined) {
                  return;
                }
                e['$$'].forEach(function (def) {
                  if (def['#name'] === 'linearGradient') {
                    registerGradient(def, defColors);
                  } else {
                    const id = '#' + def.$['id'];
                    defs[id] = def;
                  }
                });
                break;
              case 'linearGradient':
                registerGradient(e, defColors);
                return;
              case 'clipPath':
                console.error('<clipPath> is not supported');
                throw e;
            }

            let fill: string | null = e.$['fill'];
            let stroke: string | null = e.$['stroke'];
            let strokeWidth: string | null =
              e.$['stroke-width'] || parentStrokeWidth;

            // any path with an 'id' might get re-used, so remember it
            if (e.$['id']) {
              const id = '#' + e.$['id'];
              defs[id] = JSON.parse(JSON.stringify(e));
            }

            let tf: string | null = e.$['transform'];
            if (tf) {
              // fontforge import doesn't understand 3-argument 'rotate',
              // so we decompose it into translate..rotate..untranslate
              const c = '(-?(?:[0-9]*\\.[0-9]+|[0-9]+))';
              while (true) {
                const m = tf.match(
                  'rotate\\(' + c + '\\s+' + c + '\\s' + c + '\\)'
                );
                if (!m) {
                  break;
                }
                const a = Number(m[1]);
                const x = Number(m[2]);
                const y = Number(m[3]);
                const subst = `translate(${x} ${y}) rotate(${a}) translate(${-x} ${-y})`;
                tf = tf.replace(m[0], subst);
              }
              e.$['transform'] = tf;
            }

            if (fill && fill.slice(0, 3) === 'url') {
              const id = fill.slice(4, fill.length - 1);
              if (defColors[id] === undefined) {
                console.log('### ' + name + ': no mapping for ' + fill);
              } else {
                fill = defColors[id];
              }
            }
            if (stroke && stroke.slice(0, 3) === 'url') {
              const id = stroke.slice(4, stroke.length - 1);
              if (defColors[id] === undefined) {
                console.log('### ' + name + ': no mapping for ' + stroke);
              } else {
                stroke = defColors[id];
              }
            }

            fill = normalizeColor(fill) || parentFill;
            stroke = normalizeColor(stroke) || parentStroke;
            const opacity = (Number(e.$['opacity']) || 1.0) * parentOpacity;

            if (e['#name'] === 'g') {
              if (e['$$'] !== undefined) {
                parseElements(
                  fill,
                  stroke,
                  opacity,
                  strokeWidth,
                  e.$['transform'] || parentTransform,
                  e['$$']
                );
              }
            } else if (e['#name'] === 'use') {
              const href = e.$['xlink:href'];
              const target = defs[href];
              if (target) {
                parseElements(
                  fill,
                  stroke,
                  opacity,
                  strokeWidth,
                  e.$['transform'] || parentTransform,
                  [JSON.parse(JSON.stringify(target))]
                );
              }
            } else {
              if (!e.$['transform'] && parentTransform) {
                e.$['transform'] = parentTransform;
              }
              if (fill !== 'none') {
                const f: Drawable = JSON.parse(JSON.stringify(e));
                f.$['stroke'] = 'none';
                f.$['stroke-width'] = '0';
                f.$['fill'] = '#000';
                if (opacity !== 1.0) {
                  fill = applyOpacity(fill, opacity);
                }
                f.$['opacity'] = undefined;
                // Insert a Closepath before any Move commands within the path data,
                // as fontforge import doesn't handle unclosed paths reliably.
                if (f['#name'] === 'path') {
                  const d = f.$['d']
                    .replace(/M/g, 'zM')
                    .replace(/m/g, 'zm')
                    .replace(/^z/, '')
                    .replace(/zz/gi, 'z');
                  if (f.$['d'] !== d) {
                    f.$['d'] = d;
                  }
                }
                layers.push({
                  shape: sanitize(f),
                  color: fill,
                });
              }

              if (stroke !== 'none') {
                if (
                  e['#name'] !== 'path' ||
                  Number(strokeWidth) > 0.25 ||
                  (e.$['d'].length < 500 && Number(strokeWidth) > 0.1)
                ) {
                  let s = JSON.parse(JSON.stringify(e));
                  s.$['fill'] = 'none';
                  s.$['stroke'] = '#000';
                  s.$['stroke-width'] = strokeWidth;
                  if (opacity) {
                    stroke = applyOpacity(stroke, opacity);
                  }
                  s.$['opacity'] = undefined;
                  layers.push({
                    shape: sanitize(s),
                    color: stroke,
                  });
                } else {
                  //console.log("Skipping stroke in " + name + ", color " + stroke + " width " + strokeWidth);
                  //console.log(e.$);
                }
              }
            }
          });
        };

        parseElements('#000000ff', 'none', 1.0, '1', undefined, doc.svg.$$);
        scaler.drawable(
          doc.svg,
          layers.map((layer) => layer.shape)
        );

        const entry: {
          codepoint: any;
          components: { name: string; color: number }[];
        } = {
          codepoint: codepoints.length == 1 ? codepoints[0] : codepoints,
          components: [],
        };

        layers.forEach((layer, l) => {
          const shape = JSON.stringify([layer.shape]);
          let gid = cmpt_rmap.get(shape);
          if (gid !== undefined) {
            cmpt_shared.add(gid);
          } else {
            gid = `${codepoints.join('_')}-x${l.toString().padStart(2, '0')}`;
            cmpt_map.set(gid, shape);
            cmpt_meta.set(gid, doc.svg.$);
            cmpt_rmap.set(shape, gid);
          }
          let c = colr_rmap.get(layer.color);
          if (c === undefined) {
            c = colr_list.length;
            colr_list.push(layer.color);
            colr_rmap.set(layer.color, c);
          }
          entry.components.push({ name: gid, color: c });
        });

        // save entry and write fallback svg
        let mono = undefined;
        const mname = path.join(monoDir, `${name}.svg`);
        if (fs.existsSync(mname)) {
          parser.parseString(
            fs.readFileSync(mname),
            function (_, mdata: DocRoot) {
              let d = sanitize(mdata.svg.$$[0] as Drawable);
              scaler.drawable(mdata.svg, [d]);
              const p = draw(d);
              d = extract(clip(p, codepoints.join('_')));
              p.remove();
              const svg = xmlbuilder.create('svg');
              for (const a in mdata.svg.$) {
                svg.att(a, mdata.svg.$[a]);
              }
              svg.ele(d['#name'], d.$);
              mono = svg.toString();
            }
          );
        }
        const svg = xmlbuilder.create('svg');
        for (const a in doc.svg.$) {
          svg.att(a, doc.svg.$[a]);
        }
        if (codepoints.length == 1) {
          chars.push(entry);
        } else {
          ligas.push(entry);
          codepoints.forEach((u) => {
            const gname = path.join(targetDir, 'glyphs', `u${u}.svg`);
            if (!fs.existsSync(gname)) {
              fs.writeFileSync(
                path.join(targetDir, 'glyphs', `u${u}.svg`),
                svg.toString()
              );
            }
            grunt_data.push(`"u${u}": ${parseInt(u, 16)}`);
          });
        }
        fs.writeFileSync(
          path.join(targetDir, 'glyphs', `u${codepoints.join('_')}.svg`),
          mono ?? svg.toString()
        );
        grunt_data.push(`"u${codepoints.join('_')}": -1`);
      });
    },
  };
})();

const clip = (() => {
  const rect = {
    test: [
      new paper.Path('M1.99,5.99 h1 a1,1 0 0 0 -1,1Z'),
      new paper.Path('M30.01,5.99 v1 a1,1 0 0 0 -1,-1Z'),
      new paper.Path('M30.01,26.01 h-1 a1,1 0 0 0 1,-1Z'),
      new paper.Path('M1.99,26.01 v-1 a1,1 0 0 0 1,1Z'),
    ],
    clip: new paper.Path(
      'M3,6 h26 a1,1 0 0 1 1,1 v18 a1,1 0 0 1 -1,1 h-26 a1,1 0 0 1 -1,-1 v-18 a1,1 0 0 1 1,-1Z'
    ),
  };
  const square = {
    test: [
      new paper.Path('M5.99,5.99 h1 a1,1 0 0 0 -1,1Z'),
      new paper.Path('M26.01,5.99 v1 a1,1 0 0 0 -1,-1Z'),
      new paper.Path('M26.01,26.01 h-1 a1,1 0 0 0 1,-1Z'),
      new paper.Path('M5.99,26.01 v-1 a1,1 0 0 0 1,1Z'),
    ],
    clip: new paper.Path(
      'M7,6 h18 a1,1 0 0 1 1,1 v18 a1,1 0 0 1 -1,1 h-18 a1,1 0 0 1 -1,-1 v-18 a1,1 0 0 1 1,-1Z'
    ),
  };

  const T = scaler.matrix(32, 32);
  rect.test.forEach((p) => p.transform(T));
  rect.clip.transform(T);
  square.test.forEach((p) => p.transform(T));
  square.clip.transform(T);

  return function (p: paper.PathItem, name: string) {
    if (
      name.match(
        /^(?:1f1e[6-9a-f]|1f1f[0-9a-z]|1f1e8_1f1ed|1f1fb_1f1e6)(?:-|$)/
      )
    ) {
      if (square.test.some((t) => t.intersects(p))) {
        return p.intersect(square.clip);
      }
    } else {
      if (rect.test.some((t) => t.intersects(p))) {
        return p.intersect(rect.clip);
      }
    }
    return undefined;
  };
})();

const squeeze = (() => {
  return function (cmpts: CmptEntry[]) {
    if (cmpts.length == 1) {
      return;
    }
    const layers: Drawable[][] = [];
    const cache: paper.PathItem[][] = [];

    const ensure = function (index: number) {
      if (cache[index] === undefined) {
        cache[index] = layers[index].map((x) => draw(x));
      }
    };

    const move = function (from: number, to: number) {
      layers[to] = [...layers[from], ...layers[to]];
      layers[from] = [];
      cache[to] = [...cache[from], ...cache[to]];
      cache[from] = [];
      cmpt_map.delete(cmpts[from].name);
      cmpt_meta.delete(cmpts[from].name);
      cmpt_map.set(cmpts[to].name, JSON.stringify(layers[to]));
      cmpts[from] = undefined;
    };

    // try merge layers
    // j < k < i
    for (let i = 0; i < cmpts.length; i++) {
      layers.push(JSON.parse(cmpt_map.get(cmpts[i].name)));
      if (cmpt_shared.has(cmpts[i].name)) {
        continue;
      }
      for (let j = 0; j < i; j++) {
        if (
          cmpts[j] === undefined ||
          cmpt_shared.has(cmpts[j].name) ||
          cmpts[i].color !== cmpts[j].color
        ) {
          continue;
        }
        ensure(i);
        ensure(j);
        // try raise [j] to [i]
        let raise = true;
        for (let k = j + 1; k < i; k++) {
          if (cmpts[k] === undefined) {
            continue;
          }
          ensure(k);
          if (cache[j].some((x) => cache[k].some((y) => overlaps(x, y)))) {
            raise = false;
            break;
          }
        }
        if (raise) {
          move(j, i);
          continue;
        }
        // try lower [i] to [j]
        let lower = true;
        for (let k = j + 1; k < i; k++) {
          ensure(k);
          if (cache[i].some((x) => cache[k].some((y) => overlaps(x, y)))) {
            lower = false;
            break;
          }
        }
        if (lower) {
          move(i, j);
          break; // [i] invalidated
        }
      }
    }

    cache.forEach((g) => g.forEach((p) => p.remove()));
  };
})();

function generate() {
  Array.from(cmpt_map.keys()).forEach((gid) => {
    const drawables: Drawable[] = JSON.parse(cmpt_map.get(gid));
    const meta = cmpt_meta.get(gid);
    const svg = xmlbuilder.create('svg');
    for (const a in meta) {
      svg.att(a, meta[a]);
    }
    drawables.forEach((drawable) => {
      const p = clip(draw(drawable), gid);
      if (p) {
        drawable = extract(p);
        p.remove();
      }
      svg.ele(drawable['#name'], drawable.$);
    });
    // write component svg
    fs.writeFileSync(
      path.join(targetDir, 'glyphs', `u${gid}.svg`),
      svg.toString()
    );
    grunt_data.push('"u' + gid + '": -1');
  });

  const ttFont = xmlbuilder.create('ttFont');
  ttFont.att('sfntVersion', '\\x00\\x01\\x00\\x00');
  ttFont.att('ttLibVersion', '3.0');

  // COLR
  const COLR = ttFont.ele('COLR');
  const layerInfo = {};
  COLR.ele('version', { value: 0 });
  chars.forEach((entry) => {
    const glyph = COLR.ele('ColorGlyph', { name: `u${entry.codepoint}` });
    const components = entry.components.filter((cmpt) => cmpt !== undefined);
    components.forEach((cmpt) => {
      glyph.ele('layer', { colorID: cmpt.color, name: `u${cmpt.name}` });
    });
    layerInfo[entry.codepoint] = components.map((cmpt) => `u${cmpt.name}`);
  });
  ligas.forEach((entry) => {
    const glyph = COLR.ele('ColorGlyph', {
      name: `u${entry.codepoint.join('_')}`,
    });
    const components = entry.components.filter((cmpt) => cmpt !== undefined);
    components.forEach((cmpt) => {
      glyph.ele('layer', { colorID: cmpt.color, name: `u${cmpt.name}` });
    });
    layerInfo[entry.codepoint.join('_')] = components.map(
      (cmpt) => `u${cmpt.name}`
    );
  });
  fs.writeFileSync(
    path.join(targetDir, '/layer_info.json'),
    JSON.stringify(layerInfo, null, 2)
  );

  // CPAL table maps color index values to RGB colors
  const CPAL = ttFont.ele('CPAL');
  CPAL.ele('version', { value: 0 });
  CPAL.ele('numPaletteEntries', { value: colr_list.length });
  const palette = CPAL.ele('palette', { index: 0 });
  colr_list.forEach(function (color, c) {
    if (color.startsWith('url')) {
      console.warn('unexpected color: ' + color);
      color = '#000000ff';
    }
    palette.ele('color', { index: c, value: color });
  });

  // GSUB table implements the ligature rules for Regional Indicator pairs and emoji-ZWJ sequences
  const GSUB = ttFont.ele('GSUB');
  GSUB.ele('Version', { value: '0x00010000' });

  const scriptRecord = GSUB.ele('ScriptList').ele('ScriptRecord', { index: 0 });
  scriptRecord.ele('ScriptTag', { value: 'DFLT' });

  const defaultLangSys = scriptRecord.ele('Script').ele('DefaultLangSys');
  defaultLangSys.ele('ReqFeatureIndex', { value: 65535 });
  defaultLangSys.ele('FeatureIndex', { index: 0, value: 0 });

  // The ligature rules are assigned to the "ccmp" feature (*not* "liga"),
  // as they should not be disabled in contexts such as letter-spacing or
  // inter-character justification, where "normal" ligatures are turned off.
  const featureRecord = GSUB.ele('FeatureList').ele('FeatureRecord', {
    index: 0,
  });
  featureRecord.ele('FeatureTag', { value: 'ccmp' });
  featureRecord.ele('Feature').ele('LookupListIndex', { index: 0, value: 0 });

  const lookup = GSUB.ele('LookupList').ele('Lookup', { index: 0 });
  lookup.ele('LookupType', { value: 4 });
  lookup.ele('LookupFlag', { value: 0 });
  const ligatureSubst = lookup.ele('LigatureSubst', { index: 0, Format: 1 });
  const ligatureSets = {};
  const ligatureSetKeys: string[] = [];
  const addLigToSet = function (lig: LigaEntry) {
    const lead = 'u' + lig.codepoint[0];
    const follow = 'u' + lig.codepoint.slice(1).join(',u');
    const glyphName = lig['name'] || 'u' + lig.codepoint.join('_');
    if (ligatureSets[lead] === undefined) {
      ligatureSetKeys.push(lead);
      ligatureSets[lead] = [];
    }
    ligatureSets[lead].push({ components: follow, glyph: glyphName });
  };
  ligas.forEach(addLigToSet);
  extraLigas.forEach(addLigToSet);
  ligatureSetKeys.sort().forEach((glyph) => {
    const ligatureSet = ligatureSubst.ele('LigatureSet', { glyph: glyph });
    const set = ligatureSets[glyph];
    // sort ligatures with more components first
    set.sort((a, b) => {
      return b.components.length - a.components.length;
    });
    set.forEach((lig) => {
      ligatureSet.ele('Ligature', {
        components: lig.components,
        glyph: lig.glyph,
      });
    });
  });

  let ttx = fs.createWriteStream(path.join(targetDir, `${fontName}.ttx`));
  ttx.write(`<?xml version="1.0" encoding="UTF-8"?>\n`);
  ttx.write(ttFont.toString());
  ttx.end();

  // Write out the codepoints file to control character code assignments by grunt-webfont
  fs.writeFileSync(
    path.join(targetDir, 'codepoints.json'),
    `{\n${grunt_data.join(',\n')}\n}\n`
  );
}

// main()
fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir);
fs.mkdirSync(path.join(targetDir, 'glyphs'));
fs.mkdirSync(path.join(targetDir, 'colorGlyphs'));

// Read glyphs from the "extras" directory
fs.readdirSync(extrasDir).forEach((f) => {
  if (f.endsWith('.svg')) {
    const data = fs.readFileSync(extrasDir);
    parser.process(f, data);
  }
});

const colrs = fs.readdirSync(colrDir);
colrs.forEach((fname) => {
  const data = fs.readFileSync(path.join(colrDir, fname));
  parser.process(fname, data);
});
parser.clear();
chars.forEach((char) => squeeze(char.components));
ligas.forEach((liga) => squeeze(liga.components));
generate();
