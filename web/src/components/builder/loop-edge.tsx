"use client";

import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";

/**
 * The reviewer's revision loop. It is implied by the reviewer (never drawn by hand), so it is shown
 * as a dashed arc over the nodes, from the reviewer back to the agent it can send work to.
 */
export function LoopEdge({ id, sourceX, sourceY, targetX, targetY, label }: EdgeProps) {
  const lift = 150;
  const top = Math.min(sourceY, targetY) - lift;
  const path = `M ${sourceX} ${sourceY} C ${sourceX + 70} ${top}, ${targetX - 70} ${top}, ${targetX} ${targetY}`;
  const mx = (sourceX + targetX) / 2;
  const my = top + lift * 0.25;
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: "#55555c", strokeDasharray: "4 5", strokeWidth: 1.25 }} />
      <EdgeLabelRenderer>
        <span
          className="pointer-events-none absolute rounded-full bg-well px-2 py-0.5 text-[11px] text-muted"
          style={{ transform: `translate(-50%, -50%) translate(${mx}px, ${my}px)` }}
        >
          {label}
        </span>
      </EdgeLabelRenderer>
    </>
  );
}
