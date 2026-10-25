import { describe, expect, it } from "vitest";
import { mapNodes } from "@/content/product-map";
import {
  VIEW_H,
  VIEW_W,
  edgePath,
  mapEdges,
  nodePoint,
  nodeStyle,
} from "./layout";

describe("раскладка карты", () => {
  it("центры узлов внутри области схемы", () => {
    for (const n of mapNodes) {
      const p = nodePoint(n.col, n.lane);
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(VIEW_W);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(VIEW_H);
    }
    expect(nodeStyle(1, "patient")).toEqual({
      left: "10%",
      top: "16.666666666666664%",
    });
  });

  it("кривая идёт от центра к центру", () => {
    const d = edgePath({ x: 100, y: 100 }, { x: 300, y: 100 });
    expect(d).toBe("M 100 100 C 200 100, 200 100, 300 100");
    expect(edgePath({ x: 100, y: 100 }, { x: 100, y: 300 })).toBe(
      "M 100 100 C 100 200, 100 200, 100 300",
    );
  });

  it("связь на каждое «next» узла", () => {
    const edges = mapEdges(mapNodes);
    expect(edges).toHaveLength(mapNodes.reduce((n, x) => n + x.next.length, 0));
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length);
  });
});
