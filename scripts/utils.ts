import * as paper from 'paper';
import { CompoundPath, Point, Rectangle, Size } from 'paper';
import { Drawable, Path } from './types';

const rexPoly =
  /(-?[\d]+(?:\.\d+)?|-?\.\d+),? *(-?[\d]+(?:\.\d+)?|-?\.\d+),? */g;

const _absolute = function (
  elem: { [index: string]: string },
  name: string,
  ref: number
) {
  const value = elem[name]?.trim();
  if (value && value.endsWith('%')) {
    elem[name] = ((parseFloat(value) / 100.0) * ref).toString();
  }
};

const absolute = function (elem: Drawable, width: number, height: number) {
  switch (elem['#name']) {
    case 'path':
    case 'polygon':
    case 'polyline':
      return elem;
    case 'circle':
      _absolute(elem.$, 'r', width);
    case 'ellipse':
      _absolute(elem.$, 'cx', width);
      _absolute(elem.$, 'cy', width);
      if (elem['#name'] == 'circle') return;
    case 'rect':
      _absolute(elem.$, 'rx', width);
      _absolute(elem.$, 'ry', width);
      if (elem['#name'] == 'ellipse') return;
      _absolute(elem.$, 'x', width);
      _absolute(elem.$, 'y', width);
      _absolute(elem.$, 'width', width);
      _absolute(elem.$, 'height', width);
      return;
    case 'line':
      _absolute(elem.$, 'x1', width);
      _absolute(elem.$, 'y1', width);
      _absolute(elem.$, 'x2', width);
      _absolute(elem.$, 'y2', width);
      return;
  }
};

const draw = function (elem: Drawable) {
  switch (elem['#name']) {
    case 'path':
      return new CompoundPath(elem.$.d);
    case 'rect':
      if (elem.$['rx'] || elem.$['ry']) {
        return new paper.Path.Rectangle(
          new Rectangle(
            new Point(
              parseFloat(elem.$['x'] ?? '0'),
              parseFloat(elem.$['y'] ?? '0')
            ),
            new Size(
              parseFloat(elem.$['width'] ?? '0'),
              parseFloat(elem.$['height'] ?? '0')
            )
          ),
          new Size(
            parseFloat(elem.$['rx'] ?? elem.$['ry']),
            parseFloat(elem.$['ry'] ?? elem.$['rx'])
          )
        );
      } else {
        return new paper.Path.Rectangle(
          new Point(
            parseFloat(elem.$['x'] ?? '0'),
            parseFloat(elem.$['y'] ?? '0')
          ),
          new Size(
            parseFloat(elem.$['width'] ?? '0'),
            parseFloat(elem.$['height'] ?? '0')
          )
        );
      }
    case 'circle':
      return new paper.Path.Circle(
        new Point(
          parseFloat(elem.$['cx'] ?? '0'),
          parseFloat(elem.$['cy'] ?? '0')
        ),
        parseFloat(elem.$['r'] ?? '0')
      );
    case 'ellipse':
      var rx = parseFloat(elem.$['rx'] ?? '0');
      var ry = parseFloat(elem.$['ry'] ?? '0');
      return new paper.Path.Ellipse(
        new Rectangle(
          new Point(
            parseFloat(elem.$['cx'] ?? '0') - rx,
            parseFloat(elem.$['cy'] ?? '0') - ry
          ),
          new Size(2 * rx, 2 * ry)
        )
      );
    case 'line':
      return new paper.Path.Line(
        new Point(
          parseFloat(elem.$['x1'] ?? '0'),
          parseFloat(elem.$['y1'] ?? '0')
        ),
        new Point(
          parseFloat(elem.$['x2'] ?? '0'),
          parseFloat(elem.$['y2'] ?? '0')
        )
      );
    case 'polygon':
    case 'polyline':
      var matches: [string, string][] = [];
      var match: RegExpExecArray;
      rexPoly.lastIndex = 0;
      while ((match = rexPoly.exec(elem.$.points))) {
        matches.push([match[1], match[2]]);
      }
      if (elem['#name'] == 'polygon') {
        return new paper.Path(
          `M${matches.map((coor) => `${coor[0]},${coor[1]}`).join('L')}L${
            matches[0][0]
          },${matches[0][1]}Z`
        );
      } else {
        return new paper.Path(
          `M${matches.map((coor) => `${coor[0]},${coor[1]}`).join('L')}Z`
        );
      }
    default:
      throw elem['#name'];
  }
};

const overlaps = function (x: paper.PathItem, y: paper.PathItem) {
  return x.intersects(y) || x.isInside(y.bounds) || y.isInside(x.bounds);
};

const extract = function (p: paper.PathItem) {
  const path: Path = { '#name': 'path', $: { d: p.pathData } };
  return path;
};

const sanitize = function (elem: Drawable) {
  return {
    '#name': elem['#name'],
    $: {
      fill: elem.$['fill'],
      stroke: elem.$['stroke'],
      'stroke-width': elem.$['stroke-width'],
      x: elem.$['x'],
      y: elem.$['y'],
      width: elem.$['width'],
      height: elem.$['height'],
      cx: elem.$['cx'],
      cy: elem.$['cy'],
      r: elem.$['r'],
      rx: elem.$['rx'],
      ry: elem.$['ry'],
      x1: elem.$['x1'],
      y1: elem.$['y1'],
      x2: elem.$['x2'],
      y2: elem.$['y2'],
      points: elem.$['points'],
      d: elem.$['d'],
    },
  } as Drawable;
};

export { absolute, draw, overlaps, extract, sanitize };
