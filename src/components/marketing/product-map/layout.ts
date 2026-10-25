import type { MapLane } from "@/content/product-map";

/**
 * Геометрия схемы на широком экране: узлы и линии в одной системе координат
 * (viewBox 1000 × 600), поэтому раскладка не требует измерений в браузере.
 */
export const VIEW_W = 1000;
export const VIEW_H = 600;
export const LANES: readonly MapLane[] = ["patient", "system", "staff"];

const COL_W = VIEW_W / 5;
const ROW_H = VIEW_H / LANES.length;

export type Point = { x: number; y: number };

/** Центр узла: колонка 1–5, дорожка — строка. */
export function nodePoint(col: number, lane: MapLane): Point {
  return { x: COL_W * (col - 0.5), y: ROW_H * (LANES.indexOf(lane) + 0.5) };
}

/** Плавная кривая между центрами узлов: по горизонтали или по вертикали. */
export function edgePath(a: Point, b: Point): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) {
    const mx = (a.x + b.x) / 2;
    return `M ${r(a.x)} ${r(a.y)} C ${r(mx)} ${r(a.y)}, ${r(mx)} ${r(b.y)}, ${r(b.x)} ${r(b.y)}`;
  }
  const my = (a.y + b.y) / 2;
  return `M ${r(a.x)} ${r(a.y)} C ${r(a.x)} ${r(my)}, ${r(b.x)} ${r(my)}, ${r(b.x)} ${r(b.y)}`;
}

export type Edge = { id: string; from: string; to: string; d: string };

type LayoutNode = {
  id: string;
  col: number;
  lane: MapLane;
  next: readonly string[];
};

export function mapEdges(nodes: readonly LayoutNode[]): Edge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes.flatMap((from) =>
    from.next.flatMap((toId) => {
      const to = byId.get(toId);
      if (!to) return [];
      return [
        {
          id: `${from.id}-${to.id}`,
          from: from.id,
          to: to.id,
          d: edgePath(
            nodePoint(from.col, from.lane),
            nodePoint(to.col, to.lane),
          ),
        },
      ];
    }),
  );
}

/** Положение карточки в процентах контейнера. */
export function nodeStyle(col: number, lane: MapLane) {
  const p = nodePoint(col, lane);
  return {
    left: `${(p.x / VIEW_W) * 100}%`,
    top: `${(p.y / VIEW_H) * 100}%`,
  };
}
