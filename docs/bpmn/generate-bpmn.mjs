// BPMN 2.0 generator for the hAIway platform process map.
//
// Model-driven: a declarative `model` (lanes + nodes + flows) is laid out on a
// column grid and emitted as valid BPMN 2.0 XML with a full BPMNDI section so
// the file opens directly in bpmn.io / Camunda Modeler.
//
// Run: node docs/bpmn/generate-bpmn.mjs
// Out: docs/bpmn/haiway-prozesse.bpmn

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { model } from "./model.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Layout constants (px) ------------------------------------------------
const POOL_X = 160;
const POOL_Y = 80;
const POOL_LABEL_W = 30; // vertical pool title band
const LANE_LABEL_W = 30; // vertical lane title band
const CONTENT_PAD_LEFT = 20; // gap after lane label before first column
const COL_W = 260; // horizontal distance between columns
const NODE_W = 170;
const NODE_H = 74;
const EVENT_D = 36; // start/end/intermediate event diameter
const GATEWAY_D = 50;
const ROW_H = 112; // vertical distance between rows inside a lane
const LANE_PAD_TOP = 26;
const LANE_PAD_BOTTOM = 26;

const firstColX = POOL_X + POOL_LABEL_W + LANE_LABEL_W + CONTENT_PAD_LEFT;

// ---- Helpers --------------------------------------------------------------
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nodeSize(type) {
  if (type === "start" || type === "end" || type === "intermediate" || type === "timer")
    return { w: EVENT_D, h: EVENT_D };
  if (type === "gateway") return { w: GATEWAY_D, h: GATEWAY_D };
  return { w: NODE_W, h: NODE_H };
}

// ---- Index nodes & compute geometry --------------------------------------
const byId = new Map();
for (const lane of model.lanes) {
  const grid = new Set();
  for (const n of lane.nodes) {
    if (byId.has(n.id)) throw new Error(`duplicate node id: ${n.id}`);
    const key = `${n.col ?? 0}:${n.row ?? 0}`;
    if (grid.has(key)) throw new Error(`grid collision in ${lane.id} at col/row ${key} (node ${n.id})`);
    grid.add(key);
    n.lane = lane.id;
    byId.set(n.id, n);
  }
}

// Determine number of rows per lane (max row index + 1) and column extent.
let maxCol = 0;
for (const lane of model.lanes) {
  lane._rows = 0;
  for (const n of lane.nodes) {
    lane._rows = Math.max(lane._rows, (n.row ?? 0) + 1);
    maxCol = Math.max(maxCol, n.col ?? 0);
  }
}

const POOL_W = firstColX - POOL_X + maxCol * COL_W + NODE_W + 60;

// Stack lanes vertically, compute each lane's y and height, then place nodes.
let cursorY = POOL_Y;
for (const lane of model.lanes) {
  lane._y = cursorY;
  lane._h = LANE_PAD_TOP + lane._rows * ROW_H + LANE_PAD_BOTTOM;
  cursorY += lane._h;

  for (const n of lane.nodes) {
    const { w, h } = nodeSize(n.type);
    const col = n.col ?? 0;
    const row = n.row ?? 0;
    // Column anchor = left edge of a NODE_W cell; center events/gateways in it.
    const cellX = firstColX + col * COL_W;
    n.w = w;
    n.h = h;
    n.x = cellX + (NODE_W - w) / 2;
    const rowCenterY = lane._y + LANE_PAD_TOP + row * ROW_H + NODE_H / 2;
    n.y = rowCenterY - h / 2;
  }
}
const POOL_H = cursorY - POOL_Y;

// ---- Edge routing ---------------------------------------------------------
function center(n) {
  return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
}

function waypoints(s, t) {
  const sc = center(s);
  const tc = center(t);
  const dx = tc.x - sc.x;
  const dy = tc.y - sc.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    // horizontal-dominant
    const sx = dx >= 0 ? s.x + s.w : s.x;
    const tx = dx >= 0 ? t.x : t.x + t.w;
    if (Math.abs(sc.y - tc.y) < 1) return [{ x: sx, y: sc.y }, { x: tx, y: tc.y }];
    const mid = (sx + tx) / 2;
    return [
      { x: sx, y: sc.y },
      { x: mid, y: sc.y },
      { x: mid, y: tc.y },
      { x: tx, y: tc.y },
    ];
  }
  // vertical-dominant
  const sy = dy >= 0 ? s.y + s.h : s.y;
  const ty = dy >= 0 ? t.y : t.y + t.h;
  if (Math.abs(sc.x - tc.x) < 1) return [{ x: sc.x, y: sy }, { x: tc.x, y: ty }];
  const mid = (sy + ty) / 2;
  return [
    { x: sc.x, y: sy },
    { x: sc.x, y: mid },
    { x: tc.x, y: mid },
    { x: tc.x, y: ty },
  ];
}

// ---- Wire incoming/outgoing onto nodes ------------------------------------
for (const n of byId.values()) {
  n._in = [];
  n._out = [];
}
model.flows.forEach((f, i) => {
  f.id = f.id || `Flow_${i + 1}`;
  const s = byId.get(f.source);
  const t = byId.get(f.target);
  if (!s) throw new Error(`flow source not found: ${f.source}`);
  if (!t) throw new Error(`flow target not found: ${f.target}`);
  s._out.push(f.id);
  t._in.push(f.id);
});

// ---- Emit BPMN element XML ------------------------------------------------
function elementTag(n) {
  const inc = n._in.map((id) => `      <bpmn:incoming>${id}</bpmn:incoming>`).join("\n");
  const out = n._out.map((id) => `      <bpmn:outgoing>${id}</bpmn:outgoing>`).join("\n");
  const body = [inc, out].filter(Boolean).join("\n");
  const open = (tag, extra = "") =>
    `    <bpmn:${tag} id="${n.id}" name="${esc(n.name)}"${extra}>${body ? "\n" + body + "\n    " : ""}</bpmn:${tag}>`;
  switch (n.type) {
    case "start":
      return open("startEvent");
    case "end":
      return open("endEvent");
    case "intermediate":
      return `    <bpmn:intermediateCatchEvent id="${n.id}" name="${esc(n.name)}">${body ? "\n" + body + "\n    " : ""}</bpmn:intermediateCatchEvent>`;
    case "timer":
      return `    <bpmn:intermediateCatchEvent id="${n.id}" name="${esc(n.name)}">\n${body}\n      <bpmn:timerEventDefinition />\n    </bpmn:intermediateCatchEvent>`;
    case "gateway":
      return open("exclusiveGateway");
    case "service":
      return open("serviceTask");
    case "send":
      return open("sendTask");
    case "receive":
      return open("receiveTask");
    case "user":
      return open("userTask");
    case "script":
      return open("scriptTask");
    case "subprocess":
      return open("task");
    default:
      return open("task");
  }
}

// ---- Build the document ---------------------------------------------------
const allNodes = [...byId.values()];

const processChildren = allNodes.map(elementTag).join("\n");

const laneSet = model.lanes
  .map((lane) => {
    const refs = lane.nodes
      .map((n) => `        <bpmn:flowNodeRef>${n.id}</bpmn:flowNodeRef>`)
      .join("\n");
    return `      <bpmn:lane id="${lane.id}" name="${esc(lane.name)}">\n${refs}\n      </bpmn:lane>`;
  })
  .join("\n");

const flowDefs = model.flows
  .map(
    (f) =>
      `    <bpmn:sequenceFlow id="${f.id}" ${f.name ? `name="${esc(f.name)}" ` : ""}sourceRef="${f.source}" targetRef="${f.target}" />`,
  )
  .join("\n");

// DI: pool, lanes, nodes, edges
const poolShape = `      <bpmndi:BPMNShape id="${model.pool.id}_di" bpmnElement="${model.pool.id}" isHorizontal="true">
        <dc:Bounds x="${POOL_X}" y="${POOL_Y}" width="${POOL_W}" height="${POOL_H}" />
        <bpmndi:BPMNLabel />
      </bpmndi:BPMNShape>`;

const laneShapes = model.lanes
  .map(
    (lane) => `      <bpmndi:BPMNShape id="${lane.id}_di" bpmnElement="${lane.id}" isHorizontal="true">
        <dc:Bounds x="${POOL_X + POOL_LABEL_W}" y="${lane._y}" width="${POOL_W - POOL_LABEL_W}" height="${lane._h}" />
        <bpmndi:BPMNLabel />
      </bpmndi:BPMNShape>`,
  )
  .join("\n");

const nodeShapes = allNodes
  .map((n) => {
    const isRound = ["start", "end", "intermediate", "timer", "gateway"].includes(n.type);
    const label = isRound
      ? `\n        <bpmndi:BPMNLabel>\n          <dc:Bounds x="${Math.round(n.x + n.w / 2 - 50)}" y="${Math.round(n.y + n.h + 4)}" width="100" height="27" />\n        </bpmndi:BPMNLabel>`
      : "";
    return `      <bpmndi:BPMNShape id="${n.id}_di" bpmnElement="${n.id}">
        <dc:Bounds x="${Math.round(n.x)}" y="${Math.round(n.y)}" width="${n.w}" height="${n.h}" />${label}
      </bpmndi:BPMNShape>`;
  })
  .join("\n");

const edgeShapes = model.flows
  .map((f) => {
    const s = byId.get(f.source);
    const t = byId.get(f.target);
    const wps = waypoints(s, t)
      .map((p) => `        <di:waypoint x="${Math.round(p.x)}" y="${Math.round(p.y)}" />`)
      .join("\n");
    return `      <bpmndi:BPMNEdge id="${f.id}_di" bpmnElement="${f.id}">
${wps}
      </bpmndi:BPMNEdge>`;
  })
  .join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="Definitions_haiway" targetNamespace="http://bpmn.io/schema/bpmn" exporter="haiway generate-bpmn.mjs" exporterVersion="1.0">
  <bpmn:collaboration id="${model.collaborationId}">
    <bpmn:participant id="${model.pool.id}" name="${esc(model.pool.name)}" processRef="${model.processId}" />
  </bpmn:collaboration>
  <bpmn:process id="${model.processId}" isExecutable="false">
    <bpmn:laneSet id="LaneSet_1">
${laneSet}
    </bpmn:laneSet>
${processChildren}
${flowDefs}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${model.collaborationId}">
${poolShape}
${laneShapes}
${nodeShapes}
${edgeShapes}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

const outPath = join(__dirname, "haiway-prozesse.bpmn");
writeFileSync(outPath, xml, "utf8");

// ---- SVG preview (rendered from the same layout data) ---------------------
const LANE_FILL = ["#f5f7fb", "#eef2f9"];
const TYPE_STYLE = {
  user: { fill: "#dbeafe", stroke: "#2563eb" },
  service: { fill: "#dcfce7", stroke: "#16a34a" },
  script: { fill: "#fef9c3", stroke: "#ca8a04" },
  store: { fill: "#f3e8ff", stroke: "#9333ea" },
  start: { fill: "#bbf7d0", stroke: "#15803d" },
  end: { fill: "#fecaca", stroke: "#dc2626" },
  timer: { fill: "#fde68a", stroke: "#b45309" },
  gateway: { fill: "#fed7aa", stroke: "#ea580c" },
};

function wrap(text, max) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

const svgW = POOL_X + POOL_W + 40;
const svgH = POOL_Y + POOL_H + 40;
const svgParts = [];
svgParts.push(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" font-family="Segoe UI, Arial, sans-serif">`,
);
svgParts.push(
  `<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#64748b"/></marker></defs>`,
);
svgParts.push(`<rect x="0" y="0" width="${svgW}" height="${svgH}" fill="#ffffff"/>`);

// lane bands + labels
model.lanes.forEach((lane, i) => {
  const lx = POOL_X + POOL_LABEL_W;
  svgParts.push(
    `<rect x="${lx}" y="${lane._y}" width="${POOL_W - POOL_LABEL_W}" height="${lane._h}" fill="${LANE_FILL[i % 2]}" stroke="#cbd5e1"/>`,
  );
  const cy = lane._y + lane._h / 2;
  svgParts.push(
    `<text x="${lx + 16}" y="${cy}" transform="rotate(-90 ${lx + 16} ${cy})" text-anchor="middle" font-size="15" font-weight="700" fill="#334155">${esc(lane.name)}</text>`,
  );
});
// pool frame + title
svgParts.push(`<rect x="${POOL_X}" y="${POOL_Y}" width="${POOL_W}" height="${POOL_H}" fill="none" stroke="#475569" stroke-width="2"/>`);
svgParts.push(
  `<text x="${POOL_X + 15}" y="${POOL_Y + POOL_H / 2}" transform="rotate(-90 ${POOL_X + 15} ${POOL_Y + POOL_H / 2})" text-anchor="middle" font-size="16" font-weight="800" fill="#0f172a">${esc(model.pool.name)}</text>`,
);

// edges
for (const f of model.flows) {
  const pts = waypoints(byId.get(f.source), byId.get(f.target))
    .map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)
    .join(" ");
  svgParts.push(`<polyline points="${pts}" fill="none" stroke="#94a3b8" stroke-width="1.3" marker-end="url(#arrow)"/>`);
  if (f.name) {
    const wps = waypoints(byId.get(f.source), byId.get(f.target));
    const mid = wps[Math.floor(wps.length / 2)] || wps[0];
    svgParts.push(
      `<text x="${Math.round(mid.x)}" y="${Math.round(mid.y) - 3}" text-anchor="middle" font-size="9.5" fill="#475569">${esc(f.name)}</text>`,
    );
  }
}

// nodes
for (const n of allNodes) {
  const st = TYPE_STYLE[n.type] || { fill: "#e2e8f0", stroke: "#475569" };
  const round = ["start", "end", "intermediate", "timer", "gateway"].includes(n.type);
  if (n.type === "gateway") {
    const cx = n.x + n.w / 2;
    const cy = n.y + n.h / 2;
    svgParts.push(
      `<polygon points="${cx},${n.y} ${n.x + n.w},${cy} ${cx},${n.y + n.h} ${n.x},${cy}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="1.5"/>`,
    );
  } else if (round) {
    svgParts.push(
      `<circle cx="${n.x + n.w / 2}" cy="${n.y + n.h / 2}" r="${n.w / 2}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${n.type === "timer" ? 2 : 1.5}"/>`,
    );
  } else {
    svgParts.push(
      `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="8" fill="${st.fill}" stroke="${st.stroke}" stroke-width="1.5"/>`,
    );
  }
  const lines = wrap(n.name, round ? 16 : 24);
  const fs = round ? 8.5 : 10.5;
  const lh = round ? 10 : 12;
  const labelY = round ? n.y + n.h + 12 : n.y + n.h / 2 - ((lines.length - 1) * lh) / 2;
  const tx = round ? n.x + n.w / 2 : n.x + n.w / 2;
  lines.forEach((ln, i) => {
    svgParts.push(
      `<text x="${tx}" y="${Math.round(labelY + i * lh)}" text-anchor="middle" dominant-baseline="middle" font-size="${fs}" fill="#0f172a">${esc(ln)}</text>`,
    );
  });
}
svgParts.push("</svg>");
const svgPath = join(__dirname, "haiway-prozesse.svg");
writeFileSync(svgPath, svgParts.join("\n"), "utf8");

console.log(
  `Wrote ${outPath}\n  lanes=${model.lanes.length} nodes=${allNodes.length} flows=${model.flows.length}\n  canvas=${POOL_W}x${POOL_H}\nWrote ${svgPath}`,
);
