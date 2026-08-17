const EXTRA_LANE_ORDER = [2, 1, 0, 3];

export function buildProcessLaneGroups(
  lanes,
  {
    titleOverrides = {},
    accents = ["#0f9f72", "#3b82f6", "#c78116", "#0891b2"],
    groupMore = "외",
  } = {}
) {
  return partitionLanes(lanes).map((groupLanes, index) => ({
    id: `group-${index + 1}`,
    title: titleOverrides[index] ?? summarizeGroupTitle(groupLanes, groupMore),
    lanes: groupLanes,
    accent: accents[index],
  }));
}

export function buildProcessEdgeRouteSlots(edges, nodePositions) {
  const slots = new Map(
    edges.map((edge) => [
      edge.id,
      {
        sourcePort: 0,
        targetPort: 0,
        channel: 0,
        rail: 0,
        railSide: 1,
        approach: 0,
        sourceChannel: 0,
        targetChannel: 0,
        backRail: 0,
      },
    ])
  );
  const records = edges.flatMap((edge) => {
    const source = nodePositions.get(edge.source);
    const target = nodePositions.get(edge.target);
    return source && target ? [{ edge, source, target }] : [];
  });

  assignIncidentPortSlots(records, slots);
  assignChannelSlots(records, slots);
  assignEndpointChannelSlots(records, slots, "source", "sourceChannel");
  assignEndpointChannelSlots(records, slots, "target", "targetChannel");
  assignRailSlots(records, slots);
  assignBackRailSlots(records, slots);
  assignApproachSlots(records, slots);
  return slots;
}

export function buildBlockedRailNudge(channel, side, gap) {
  return side * Math.max(0, channel) * gap;
}

function assignIncidentPortSlots(records, slots) {
  const incidents = records.flatMap((record) => [
    {
      ...record,
      nodeId: record.edge.source,
      endpoint: "source",
      counterpart: record.target,
    },
    {
      ...record,
      nodeId: record.edge.target,
      endpoint: "target",
      counterpart: record.source,
    },
  ]);
  const grouped = groupBy(incidents, ({ nodeId }) => nodeId);
  for (const group of grouped.values()) {
    const sorted = [...group].sort((left, right) => {
      const leftPosition = left.counterpart;
      const rightPosition = right.counterpart;
      return (
        leftPosition.groupIndex - rightPosition.groupIndex ||
        leftPosition.stageIndex - rightPosition.stageIndex ||
        left.endpoint.localeCompare(right.endpoint) ||
        left.edge.type.localeCompare(right.edge.type) ||
        left.edge.id.localeCompare(right.edge.id)
      );
    });
    const center = (sorted.length - 1) / 2;
    const scale = center > 2.5 ? 2.5 / center : 1;
    sorted.forEach(({ edge, endpoint }, index) => {
      const slot = slots.get(edge.id);
      slot[`${endpoint}Port`] = (index - center) * scale;
    });
  }
}

function assignChannelSlots(records, slots) {
  const candidates = records.flatMap((record) => {
    const { edge, source, target } = record;
    const sameCell =
      source.stageIndex === target.stageIndex &&
      source.groupIndex === target.groupIndex;
    if (sameCell && edge.type === "sequence") return [];
    const rowIndex = Math.min(source.stageIndex, target.stageIndex);
    return [
      {
        ...record,
        key: rowIndex,
        start: Math.min(source.groupIndex, target.groupIndex) - 0.45,
        end: Math.max(source.groupIndex, target.groupIndex) + 0.45,
      },
    ];
  });

  const grouped = groupBy(candidates, ({ key }) => key);
  for (const group of grouped.values()) {
    assignIntervalSlots(group, ({ edge }, channel) => {
      slots.get(edge.id).channel = channel;
    });
  }
}

function assignEndpointChannelSlots(records, slots, endpoint, property) {
  const candidates = records.map((record) => ({
    ...record,
    key: record[endpoint].stageIndex,
    start: Math.min(record.source.groupIndex, record.target.groupIndex) - 0.45,
    end: Math.max(record.source.groupIndex, record.target.groupIndex) + 0.45,
  }));
  const grouped = groupBy(candidates, ({ key }) => key);
  for (const group of grouped.values()) {
    assignIntervalSlots(group, ({ edge }, channel) => {
      slots.get(edge.id)[property] = channel;
    });
  }
}

function assignRailSlots(records, slots) {
  const candidates = records.flatMap((record) => {
    const { edge, source, target } = record;
    if (target.stageIndex - source.stageIndex <= 1) return [];
    const slot = slots.get(edge.id);
    const railSide =
      source.groupIndex < target.groupIndex
        ? 1
        : source.groupIndex > target.groupIndex
          ? -1
          : slot.sourcePort < 0
            ? -1
            : 1;
    slot.railSide = railSide;
    return [
      {
        ...record,
        key: `${target.groupIndex}:${railSide}`,
        start: source.stageIndex,
        end: target.stageIndex,
      },
    ];
  });

  const grouped = groupBy(candidates, ({ key }) => key);
  for (const group of grouped.values()) {
    assignIntervalSlots(group, ({ edge }, rail) => {
      slots.get(edge.id).rail = rail;
    });
  }
}

function assignApproachSlots(records, slots) {
  const candidates = records.flatMap((record) => {
    const { source, target } = record;
    if (target.stageIndex - source.stageIndex <= 1) return [];
    return [
      {
        ...record,
        key: target.stageIndex,
        start: target.groupIndex - 0.45,
        end: target.groupIndex + 0.45,
      },
    ];
  });
  const grouped = groupBy(candidates, ({ key }) => key);
  for (const group of grouped.values()) {
    assignIntervalSlots(group, ({ edge }, approach) => {
      slots.get(edge.id).approach = approach;
    });
  }
}

function assignBackRailSlots(records, slots) {
  const candidates = records.flatMap((record) => {
    const { edge, source, target } = record;
    const sameCellEdge =
      edge.type !== "message" &&
      target.stageIndex === source.stageIndex &&
      target.groupIndex === source.groupIndex;
    if (target.stageIndex >= source.stageIndex && !sameCellEdge) return [];
    return [
      {
        ...record,
        key: "backward",
        start: sameCellEdge ? source.stageIndex - 0.1 : target.stageIndex,
        end: sameCellEdge ? source.stageIndex + 0.1 : source.stageIndex,
      },
    ];
  });
  assignIntervalSlots(candidates, ({ edge }, backRail) => {
    slots.get(edge.id).backRail = backRail;
  });
}

function assignIntervalSlots(records, assign) {
  const slotEnds = [];
  [...records]
    .sort(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        left.edge.id.localeCompare(right.edge.id)
    )
    .forEach((record) => {
      let slot = slotEnds.findIndex((end) => record.start > end + 0.05);
      if (slot === -1) {
        slot = slotEnds.length;
        slotEnds.push(record.end);
      } else {
        slotEnds[slot] = record.end;
      }
      assign(record, slot);
    });
}

function groupBy(values, keyFor) {
  const grouped = new Map();
  for (const value of values) {
    const key = keyFor(value);
    const group = grouped.get(key) ?? [];
    group.push(value);
    grouped.set(key, group);
  }
  return grouped;
}

function partitionLanes(lanes) {
  const groupCount = Math.min(4, lanes.length);
  if (groupCount === 0) return [];

  const baseSize = Math.floor(lanes.length / groupCount);
  const sizes = Array.from({ length: groupCount }, () => baseSize);
  const remainder = lanes.length % groupCount;
  const order = EXTRA_LANE_ORDER.filter((index) => index < groupCount);
  for (let index = 0; index < remainder; index += 1) {
    sizes[order[index] ?? index] += 1;
  }

  let cursor = 0;
  return sizes.map((size) => {
    const group = lanes.slice(cursor, cursor + size);
    cursor += size;
    return group;
  });
}

function summarizeGroupTitle(lanes, groupMore = "외") {
  if (lanes.length === 1) return truncate(compactLaneLabel(lanes[0]), 18);
  if (lanes.length === 2) {
    return truncate(
      `${compactLaneLabel(lanes[0])}·${compactLaneLabel(lanes[1])}`,
      18
    );
  }
  const first = truncate(compactLaneLabel(lanes[0]), 13);
  const rest = lanes.length - 1;
  // Word-like connectors (e.g. Korean "외") read as their own token and get
  // spaces on both sides ("First 외 2"); symbol connectors (e.g. "+") attach
  // directly to the count with only a leading space ("First +2").
  return /\p{L}/u.test(groupMore)
    ? `${first} ${groupMore} ${rest}`
    : `${first} ${groupMore}${rest}`;
}

function compactLaneLabel(lane) {
  const cleaned = lane
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replaceAll("/", "·")
    .trim();
  if (Array.from(cleaned).length <= 9) return cleaned;
  return cleaned.split("·")[0].trim();
}

function truncate(value, maxLength) {
  const chars = Array.from(value);
  return chars.length <= maxLength
    ? value
    : `${chars.slice(0, maxLength - 1).join("")}…`;
}

// ---------------------------------------------------------------------------
// Geometry: canvas layout constants, port of korea100's
// generate-process-article-image.mjs (branch feat/composition-quality,
// commit 697198e "gutter-route in-row & return edges to avoid hiding behind
// cards"). Values copied exactly. Korea-specific / renderer-only constants
// (STATUS colors, ORDINANCE_*, CARD_TITLE_*, card text sizing) are left out
// on purpose — those belong to the SVG renderer (Task 6), not this layer.
// ---------------------------------------------------------------------------

export const WIDTH = 1520;
export const HEIGHT = 2400;
const GRID_LEFT = 38;
const GRID_RIGHT = 1482;
const GRID_TOP = 260;
const GROUP_HEADER_HEIGHT = 100;
const STAGE_LABEL_WIDTH = 190;
const GROUP_X = GRID_LEFT + STAGE_LABEL_WIDTH;
const GRID_BOTTOM = 2200;
const STAGE_BODY_TOP = GRID_TOP + GROUP_HEADER_HEIGHT;
const STAGE_BODY_HEIGHT = GRID_BOTTOM - STAGE_BODY_TOP;
const CARD_WIDTH = 372;
const CARD_HEIGHT = 122;
const CARD_GAP = 24;
const STAGE_VERTICAL_SPACE = 40;
const MIN_STAGE_HEIGHT = 160;
const DEFAULT_LAYOUT_METRICS = Object.freeze({
  cardHeight: CARD_HEIGHT,
  cardGap: CARD_GAP,
  stageVerticalSpace: STAGE_VERTICAL_SPACE,
  minStageHeight: MIN_STAGE_HEIGHT,
});
// Preserve the 1800x2400 export while keeping dense, legally complete flows readable.
const COMPACT_LAYOUT_METRICS = Object.freeze({
  cardHeight: 86,
  cardGap: 20,
  stageVerticalSpace: 16,
  minStageHeight: 124,
});
// Dense diagrams retain the compact card height; only their inter-card and stage padding contracts.
const DENSE_LAYOUT_METRICS = Object.freeze({
  cardHeight: 86,
  cardGap: 16,
  stageVerticalSpace: 8,
  minStageHeight: 120,
});
const ARROW_CLEARANCE = 8;
// Edge label box geometry (not text sizing) — needed by buildEdgeLabelLayout
// to reserve/avoid rectangles; kept here alongside the other EDGE_* constants
// since it is structural, not Korea-specific text styling.
const EDGE_LABEL_HEIGHT = 30;
const EDGE_LABEL_GAP = 7;
const EDGE_PORT_GAP = 20;
const EDGE_CHANNEL_GAP = 16;
const EDGE_RAIL_GAP = 13;
const EDGE_RAIL_INSET = 18;
const MAX_COLLINEAR_EDGE_OVERLAP = 40;

/**
 * Build the full pixel layout for a board: stage heights, node positions,
 * edge route slots, edge route validation, edge label placement.
 *
 * Signature intentionally differs from the korea100 source (which took
 * (institution, process, groups)): this port takes the board document
 * directly and derives process/groups internally, and must not depend on
 * institution.slug / institution.category anywhere.
 */
export function buildLayout(board, { titleOverrides = {}, groupMore = "외" } = {}) {
  const process = {
    lanes: board.lanes,
    stages: board.stages,
    nodes: board.nodes,
    edges: board.edges,
  };
  const groups = buildProcessLaneGroups(process.lanes, { titleOverrides, groupMore });

  const groupWidth = (GRID_RIGHT - GROUP_X) / groups.length;
  const stageIndex = new Map(process.stages.map((stage, index) => [stage, index]));
  const groupByLane = new Map(
    groups.flatMap((group, groupIndex) =>
      group.lanes.map((lane) => [lane, groupIndex])
    )
  );
  const nodesByCell = new Map();

  for (const node of process.nodes) {
    const rowIndex = stageIndex.get(node.stage);
    const groupIndex = groupByLane.get(node.lane);
    if (rowIndex === undefined || groupIndex === undefined) {
      throw new Error(`Node placement missing lane/stage mapping: ${node.id}`);
    }
    const key = `${rowIndex}:${groupIndex}`;
    const cell = nodesByCell.get(key) ?? [];
    cell.push(node);
    nodesByCell.set(key, cell);
  }

  const maxCellCounts = process.stages.map((_, rowIndex) =>
    Math.max(
      1,
      ...groups.map(
        (_, groupIndex) => nodesByCell.get(`${rowIndex}:${groupIndex}`)?.length ?? 0
      )
    )
  );
  let layoutMetrics = DEFAULT_LAYOUT_METRICS;
  let desiredStageHeights = calculateDesiredStageHeights(
    maxCellCounts,
    layoutMetrics
  );
  let desiredTotal = desiredStageHeights.reduce((sum, height) => sum + height, 0);
  if (desiredTotal > STAGE_BODY_HEIGHT) {
    layoutMetrics = COMPACT_LAYOUT_METRICS;
    desiredStageHeights = calculateDesiredStageHeights(
      maxCellCounts,
      layoutMetrics
    );
    desiredTotal = desiredStageHeights.reduce((sum, height) => sum + height, 0);
  }
  if (desiredTotal > STAGE_BODY_HEIGHT) {
    layoutMetrics = DENSE_LAYOUT_METRICS;
    desiredStageHeights = calculateDesiredStageHeights(
      maxCellCounts,
      layoutMetrics
    );
    desiredTotal = desiredStageHeights.reduce((sum, height) => sum + height, 0);
  }
  if (desiredTotal > STAGE_BODY_HEIGHT) {
    throw new Error(
      `portrait canvas height exceeded: ${board.title} (${desiredTotal}/${STAGE_BODY_HEIGHT})`
    );
  }
  const extraPerStage = (STAGE_BODY_HEIGHT - desiredTotal) / process.stages.length;
  const stageHeights = desiredStageHeights.map((height) => height + extraPerStage);
  const stageTops = [];
  let currentY = STAGE_BODY_TOP;
  for (const stageHeight of stageHeights) {
    stageTops.push(currentY);
    currentY += stageHeight;
  }

  const nodeLayout = new Map();
  for (const [key, cellNodes] of nodesByCell) {
    const [rowIndex, groupIndex] = key.split(":").map(Number);
    const stackHeight =
      cellNodes.length * layoutMetrics.cardHeight +
      (cellNodes.length - 1) * layoutMetrics.cardGap;
    const firstY = stageTops[rowIndex] + (stageHeights[rowIndex] - stackHeight) / 2;
    // 카드 폭은 레인 폭에 맞춰 축소 — 좌우에 연결선이 지날 여백(최소 130)을 남겨 관통을 막는다
    const cardW = Math.max(300, Math.min(CARD_WIDTH, groupWidth - 130));
    const x =
      GROUP_X +
      groupIndex * groupWidth +
      (groupWidth - cardW) / 2;
    cellNodes.forEach((node, nodeIndex) => {
      nodeLayout.set(node.id, {
        x,
        y:
          firstY +
          nodeIndex * (layoutMetrics.cardHeight + layoutMetrics.cardGap),
        width: cardW,
        height: layoutMetrics.cardHeight,
        stageIndex: rowIndex,
        groupIndex,
      });
    });
  }

  if (nodeLayout.size !== process.nodes.length) {
    throw new Error(`Node placement count mismatch: ${board.title}`);
  }

  const context = {
    board,
    process,
    groups,
    groupWidth,
    groupByLane,
    stageIndex,
    stageHeights,
    stageTops,
    layoutMetrics,
    nodeLayout,
    edgeRouteSlots: buildProcessEdgeRouteSlots(process.edges, nodeLayout),
  };
  context.edgeRouteAudit = validateEdgeRouteLayout(context);
  context.edgeLabelLayout = buildEdgeLabelLayout(context);
  context.textAudit = validateTextLayout(context);
  return context;
}

function calculateDesiredStageHeights(maxCellCounts, metrics) {
  return maxCellCounts.map((count) =>
    Math.max(
      metrics.minStageHeight,
      count * metrics.cardHeight +
        (count - 1) * metrics.cardGap +
        metrics.stageVerticalSpace
    )
  );
}

function buildEdgeLabelLayout(context) {
  const placements = new Map();
  const reserved = [
    ...Array.from(context.nodeLayout.values(), (node) =>
      expandRect(
        { x: node.x, y: node.y, width: node.width, height: node.height },
        EDGE_LABEL_GAP
      )
    ),
    ...context.stageTops.map((top, index) => ({
      x: GRID_LEFT + 8,
      y: top + 10,
      width: STAGE_LABEL_WIDTH - 16,
      height: Math.min(98, context.stageHeights[index] - 18),
    })),
  ];
  const placed = [];

  for (const edge of context.process.edges) {
    if (!edge.label) continue;
    const source = context.nodeLayout.get(edge.source);
    const target = context.nodeLayout.get(edge.target);
    if (!source || !target) continue;
    const route = edgeRoute(edge, source, target, context);
    const width = Math.max(96, estimatedTextWidth(edge.label, 14) + 26);
    const placement = findFreeEdgeLabel(
      route.labelX,
      route.labelY,
      width,
      context,
      reserved,
      placed
    );
    if (!placement) {
      throw new Error(
        `unresolvable edge-label collision: ${context.board.title}/${edge.id}`
      );
    }
    const rect = {
      x: placement.x - width / 2,
      y: placement.y - EDGE_LABEL_HEIGHT / 2,
      width,
      height: EDGE_LABEL_HEIGHT,
    };
    placed.push(expandRect(rect, EDGE_LABEL_GAP));
    placements.set(edge.id, {
      x: placement.x,
      y: placement.y,
      width,
      adjusted:
        Math.abs(placement.x - route.labelX) > 0.1 ||
        Math.abs(placement.y - route.labelY) > 0.1,
    });
  }
  return placements;
}

function findFreeEdgeLabel(anchorX, anchorY, width, context, reserved, placed) {
  const xOffsets = [0, -70, 70, -140, 140, -210, 210, -280, 280, -350, 350, -420, 420];
  const yOffsets = [0, -36, 36, -72, 72, -108, 108, -144, 144, -180, 180];
  const candidates = yOffsets
    .flatMap((dy) => xOffsets.map((dx) => ({ x: anchorX + dx, y: anchorY + dy, dx, dy })))
    .sort(
      (a, b) =>
        Math.abs(a.dx) + Math.abs(a.dy) * 1.25 -
        (Math.abs(b.dx) + Math.abs(b.dy) * 1.25)
    );

  for (const candidate of candidates) {
    const rect = {
      x: candidate.x - width / 2,
      y: candidate.y - EDGE_LABEL_HEIGHT / 2,
      width,
      height: EDGE_LABEL_HEIGHT,
    };
    if (
      rect.x < GRID_LEFT + 5 ||
      rect.x + rect.width > GRID_RIGHT - 5 ||
      rect.y < STAGE_BODY_TOP + 5 ||
      rect.y + rect.height > GRID_BOTTOM - 5
    ) {
      continue;
    }
    if (reserved.some((item) => rectsOverlap(rect, item))) continue;
    if (placed.some((item) => rectsOverlap(rect, item))) continue;
    return candidate;
  }
  return null;
}

function expandRect(rect, amount) {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}

function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function verticalRouteBlocked(x, startY, endY, edge, context) {
  const top = Math.min(startY, endY);
  const bottom = Math.max(startY, endY);
  return [...context.nodeLayout.entries()].some(([nodeId, node]) => {
    if (nodeId === edge.source || nodeId === edge.target) return false;
    return (
      x > node.x - 4 &&
      x < node.x + node.width + 4 &&
      bottom > node.y - 4 &&
      top < node.y + node.height + 4
    );
  });
}

function horizontalRouteBlocked(y, startX, endX, edge, context) {
  const left = Math.min(startX, endX);
  const right = Math.max(startX, endX);
  return [...context.nodeLayout.entries()].some(([nodeId, node]) => {
    if (nodeId === edge.source || nodeId === edge.target) return false;
    return (
      y > node.y - 4 &&
      y < node.y + node.height + 4 &&
      right > node.x - 4 &&
      left < node.x + node.width + 4
    );
  });
}

function validateEdgeRouteLayout(context) {
  const routes = context.process.edges.map((edge) => {
    const source = context.nodeLayout.get(edge.source);
    const target = context.nodeLayout.get(edge.target);
    return {
      edge,
      route: edgeRoute(edge, source, target, context),
      long: target.stageIndex - source.stageIndex > 1,
    };
  });
  const overlaps = [];
  for (let leftIndex = 0; leftIndex < routes.length; leftIndex += 1) {
    const left = routes[leftIndex];
    const leftSegments = orthogonalSegments(left.route.path);
    for (let rightIndex = leftIndex + 1; rightIndex < routes.length; rightIndex += 1) {
      const right = routes[rightIndex];
      const rightSegments = orthogonalSegments(right.route.path);
      let longest = 0;
      for (const leftSegment of leftSegments) {
        for (const rightSegment of rightSegments) {
          longest = Math.max(longest, collinearOverlap(leftSegment, rightSegment));
        }
      }
      if (longest > MAX_COLLINEAR_EDGE_OVERLAP) {
        overlaps.push({
          ids: `${left.edge.id}/${right.edge.id}`,
          length: round(longest),
          leftPath: left.route.path,
          rightPath: right.route.path,
        });
      }
    }
  }
  if (overlaps.length > 0) {
    throw new Error(
      `collinear edge overlap: ${context.board.title}\n- ${overlaps
        .slice(0, 12)
        .map(
          ({ ids, length, leftPath, rightPath }) =>
            `${ids} ${length}px\n  ${leftPath}\n  ${rightPath}`
        )
        .join("\n- ")}`
    );
  }
  return {
    routes: routes.length,
    longRoutes: routes.filter(({ long }) => long).length,
  };
}

export function orthogonalSegments(pathData) {
  const tokens = pathData.match(/[MHV]|-?\d+(?:\.\d+)?/g) ?? [];
  const segments = [];
  let x = 0;
  let y = 0;
  for (let index = 0; index < tokens.length; ) {
    const command = tokens[index];
    index += 1;
    if (command === "M") {
      x = Number(tokens[index]);
      y = Number(tokens[index + 1]);
      index += 2;
      continue;
    }
    if (command === "H") {
      const nextX = Number(tokens[index]);
      index += 1;
      segments.push({ orientation: "horizontal", fixed: y, start: x, end: nextX });
      x = nextX;
      continue;
    }
    if (command === "V") {
      const nextY = Number(tokens[index]);
      index += 1;
      segments.push({ orientation: "vertical", fixed: x, start: y, end: nextY });
      y = nextY;
    }
  }
  return segments;
}

function collinearOverlap(left, right) {
  if (
    left.orientation !== right.orientation ||
    Math.abs(left.fixed - right.fixed) > 0.1
  ) {
    return 0;
  }
  const leftStart = Math.min(left.start, left.end);
  const leftEnd = Math.max(left.start, left.end);
  const rightStart = Math.min(right.start, right.end);
  const rightEnd = Math.max(right.start, right.end);
  return Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart));
}

export function edgeRoute(edge, source, target, context) {
  const sourceCenterX = source.x + source.width / 2;
  const sourceCenterY = source.y + source.height / 2;
  const targetCenterX = target.x + target.width / 2;
  const targetCenterY = target.y + target.height / 2;
  const sourceRight = source.x + source.width;
  const targetRight = target.x + target.width;
  const sourceBottom = source.y + source.height;
  const targetBottom = target.y + target.height;
  const slot = context.edgeRouteSlots.get(edge.id) ?? {
    sourcePort: 0,
    targetPort: 0,
    channel: 0,
    rail: 0,
    railSide: 1,
    approach: 0,
    sourceChannel: 0,
    targetChannel: 0,
    backRail: 0,
  };
  const sourcePortX =
    sourceCenterX +
    slot.sourcePort * EDGE_PORT_GAP +
    alternatingSlotOffset(slot.sourceChannel) * 6 +
    alternatingSlotOffset(slot.channel) * 6;
  const targetPortX =
    targetCenterX +
    slot.targetPort * EDGE_PORT_GAP +
    alternatingSlotOffset(slot.targetChannel) * 6 +
    alternatingSlotOffset(slot.channel) * 6;

  if (source.stageIndex === target.stageIndex && source.groupIndex === target.groupIndex) {
    if (edge.type === "message") {
      const sideX = sourceRight + 28 + slot.channel * EDGE_RAIL_GAP;
      const sourceSideY =
        sourceCenterY + sidePortOffset(slot.sourcePort, slot.sourceChannel);
      const targetSideY =
        targetCenterY + sidePortOffset(slot.targetPort, slot.targetChannel);
      return {
        path: `M ${round(sourceRight)} ${round(sourceSideY)} H ${round(sideX)} V ${round(targetSideY)} H ${round(targetRight + ARROW_CLEARANCE)}`,
        labelX: sideX + 58,
        labelY: (sourceSideY + targetSideY) / 2,
      };
    }
    const downward = target.y >= sourceBottom;
    // Fan same-cell branches out in port order before they approach their targets.
    // This keeps a farther branch from sharing the nearer branch's target stem.
    const middleY = Math.max(
      sourceBottom + ARROW_CLEARANCE + 8,
      Math.min(
        target.y - ARROW_CLEARANCE - 8,
        sourceBottom + 36 - slot.sourcePort * 28
      )
    );
    return {
      path: downward
        ? Math.abs(sourcePortX - targetPortX) < 1
          ? `M ${round(sourcePortX)} ${round(sourceBottom)} V ${round(target.y - ARROW_CLEARANCE)}`
          : `M ${round(sourcePortX)} ${round(sourceBottom)} V ${round(middleY)} H ${round(targetPortX)} V ${round(target.y - ARROW_CLEARANCE)}`
        : `M ${round(source.x)} ${round(sourceCenterY + sidePortOffset(slot.sourcePort, slot.sourceChannel))} H ${round(GROUP_X - 12 - slot.backRail * EDGE_RAIL_GAP)} V ${round(targetCenterY + sidePortOffset(slot.targetPort, slot.targetChannel))} H ${round(target.x - ARROW_CLEARANCE)}`,
      labelX: downward ? sourceRight + 50 : GROUP_X + 48,
      labelY: (sourceCenterY + targetCenterY) / 2,
    };
  }

  if (source.stageIndex === target.stageIndex) {
    const forward = target.groupIndex > source.groupIndex;
    const sourceSideY =
      sourceCenterY + sidePortOffset(slot.sourcePort, slot.sourceChannel);
    const targetSideY =
      targetCenterY + sidePortOffset(slot.targetPort, slot.targetChannel);
    const channelX = forward
      ? target.x - 28 - slot.channel * EDGE_RAIL_GAP
      : targetRight + 28 + slot.channel * EDGE_RAIL_GAP;
    // A straight in-row connector runs at card-center height and would pass
    // behind any card sitting between source and target. When that happens,
    // drop into the row's bottom gutter (below all cards) and cross there so
    // the connection stays visible instead of hiding behind a card.
    const directStartX = forward ? sourceRight : source.x;
    const rowBottom =
      context.stageTops[source.stageIndex] + context.stageHeights[source.stageIndex];
    const gutterY = rowBottom - 14 - slot.channel * EDGE_CHANNEL_GAP;
    const blocked =
      horizontalRouteBlocked(sourceSideY, directStartX, channelX, edge, context) &&
      gutterY > Math.max(sourceBottom, targetBottom) + 6;
    if (blocked) {
      return {
        path: `M ${round(sourcePortX)} ${round(sourceBottom)} V ${round(gutterY)} H ${round(targetPortX)} V ${round(targetBottom + ARROW_CLEARANCE)}`,
        labelX: (sourcePortX + targetPortX) / 2,
        labelY: gutterY - 17,
      };
    }
    return {
      path: forward
        ? `M ${round(sourceRight)} ${round(sourceSideY)} H ${round(channelX)} V ${round(targetSideY)} H ${round(target.x - ARROW_CLEARANCE)}`
        : `M ${round(source.x)} ${round(sourceSideY)} H ${round(channelX)} V ${round(targetSideY)} H ${round(targetRight + ARROW_CLEARANCE)}`,
      labelX: forward
        ? (sourceRight + target.x) / 2
        : (source.x + targetRight) / 2,
      labelY: (sourceSideY + targetSideY) / 2 - 17,
    };
  }

  if (target.stageIndex > source.stageIndex) {
    const sourceRowBottom =
      context.stageTops[source.stageIndex] + context.stageHeights[source.stageIndex];
    const channelY = sourceRowBottom - 12 - slot.channel * EDGE_CHANNEL_GAP;
    const sourceBlocked = verticalRouteBlocked(
      sourcePortX,
      sourceBottom,
      channelY,
      edge,
      context
    );
    const sourceSide =
      target.groupIndex > source.groupIndex
        ? 1
        : target.groupIndex < source.groupIndex
          ? -1
          : slot.railSide;
    const sourceGroupLeft = GROUP_X + source.groupIndex * context.groupWidth;
    const blockedRailNudge = buildBlockedRailNudge(
      slot.sourceChannel,
      sourceSide,
      EDGE_RAIL_GAP
    );
    const sourceRailCandidate =
      sourceSide < 0
        ? sourceGroupLeft + EDGE_RAIL_INSET + blockedRailNudge
        : sourceGroupLeft +
          context.groupWidth -
          EDGE_RAIL_INSET +
          blockedRailNudge;
    // Channel offsets may not pull a detour rail back through its source card.
    const sourceRailX =
      sourceSide < 0
        ? Math.min(sourceRailCandidate, source.x - ARROW_CLEARANCE)
        : Math.max(sourceRailCandidate, sourceRight + ARROW_CLEARANCE);
    const sourcePath = sourceBlocked
      ? sourceSide < 0
        ? `M ${round(source.x)} ${round(sourceCenterY + sidePortOffset(slot.sourcePort, slot.sourceChannel))} H ${round(sourceRailX)} V ${round(channelY)}`
        : `M ${round(sourceRight)} ${round(sourceCenterY + sidePortOffset(slot.sourcePort, slot.sourceChannel))} H ${round(sourceRailX)} V ${round(channelY)}`
      : `M ${round(sourcePortX)} ${round(sourceBottom)} V ${round(channelY)}`;
    if (target.stageIndex - source.stageIndex > 1) {
      const targetGroupLeft = GROUP_X + target.groupIndex * context.groupWidth;
      // Keep channel offsets subordinate to the assigned rail so they cannot cancel it.
      const routeRailNudge = alternatingSlotOffset(slot.channel) * 4;
      const railX =
        slot.railSide < 0
          ? targetGroupLeft +
            EDGE_RAIL_INSET +
            slot.rail * EDGE_RAIL_GAP +
            routeRailNudge
          : targetGroupLeft +
            context.groupWidth -
            EDGE_RAIL_INSET -
            slot.rail * EDGE_RAIL_GAP +
            routeRailNudge;
      const longRailX =
        sourceBlocked && source.groupIndex === target.groupIndex
          // Separate long routes sharing a source rail when they fan into different target ports.
          ? sourceRailX +
            slot.railSide *
              ((Math.abs(slot.targetChannel - slot.sourceChannel) + 2 + slot.rail) *
                EDGE_RAIL_GAP)
          : railX;
      const targetApproachY = target.y - 28 - slot.approach * 10;
      const longSourcePath =
        sourceBlocked
          ? sourceSide < 0
            ? `M ${round(source.x)} ${round(sourceCenterY + sidePortOffset(slot.sourcePort, slot.sourceChannel))} H ${round(longRailX)} V ${round(channelY)}`
            : `M ${round(sourceRight)} ${round(sourceCenterY + sidePortOffset(slot.sourcePort, slot.sourceChannel))} H ${round(longRailX)} V ${round(channelY)}`
          : sourcePath;
      return {
        path: `${longSourcePath} H ${round(longRailX)} V ${round(targetApproachY)} H ${round(targetPortX)} V ${round(target.y - ARROW_CLEARANCE)}`,
        labelX: longRailX,
        labelY: (channelY + targetApproachY) / 2,
      };
    }
    const targetBlocked = verticalRouteBlocked(
      targetPortX,
      channelY,
      target.y - ARROW_CLEARANCE,
      edge,
      context
    );
    if (targetBlocked) {
      const targetSide =
        source.groupIndex < target.groupIndex
          ? -1
          : source.groupIndex > target.groupIndex
            ? 1
            : slot.railSide;
      const targetGroupLeft = GROUP_X + target.groupIndex * context.groupWidth;
      const targetRailNudge =
        alternatingSlotOffset(slot.targetChannel) * EDGE_RAIL_GAP;
      const targetRailX =
        targetSide < 0
          ? targetGroupLeft + EDGE_RAIL_INSET + targetRailNudge
          : targetGroupLeft +
            context.groupWidth -
            EDGE_RAIL_INSET +
            targetRailNudge;
      return {
        path:
          targetSide < 0
            ? `${sourcePath} H ${round(targetRailX)} V ${round(targetCenterY + sidePortOffset(slot.targetPort, slot.targetChannel))} H ${round(target.x - ARROW_CLEARANCE)}`
            : `${sourcePath} H ${round(targetRailX)} V ${round(targetCenterY + sidePortOffset(slot.targetPort, slot.targetChannel))} H ${round(targetRight + ARROW_CLEARANCE)}`,
        labelX: (sourcePortX + targetRailX) / 2,
        labelY: channelY - 17,
      };
    }
    return {
      path: `${sourcePath} H ${round(targetPortX)} V ${round(target.y - ARROW_CLEARANCE)}`,
      labelX: (sourcePortX + targetPortX) / 2,
      labelY: channelY - 17,
    };
  }

  const railX = GROUP_X - 12 - slot.backRail * EDGE_RAIL_GAP;
  const targetRowBottom =
    context.stageTops[target.stageIndex] + context.stageHeights[target.stageIndex];

  const rowClearY = (stageIndex, base) => {
    if (base >= targetRowBottom) return base;
    const cardsBottom = Math.max(
      ...[...context.nodeLayout.values()]
        .filter((node) => node.stageIndex === stageIndex)
        .map((node) => node.y + node.height)
    );
    const clear = cardsBottom + 12 + slot.channel * EDGE_CHANNEL_GAP;
    return clear;
  };

  // Source leaves leftward toward the return rail at card-center height, which
  // hides behind any card to its left in the source row. When blocked, exit the
  // card bottom into the source-row gutter first, then run left along it.
  const sourceExitY =
    sourceCenterY + sidePortOffset(slot.sourcePort, slot.sourceChannel);
  const sourceRowBottom =
    context.stageTops[source.stageIndex] + context.stageHeights[source.stageIndex];
  // Use the backward-edge rail slot (deconflicted among return edges) and a 7px
  // constant offset so this gutter band can never sit collinear with the
  // same-stage gutter bands (which key off slot.channel at rowBottom-14).
  const sourceGutterY = sourceRowBottom - 21 - slot.backRail * EDGE_CHANNEL_GAP;
  const useSourceGutter =
    horizontalRouteBlocked(sourceExitY, source.x, railX, edge, context) &&
    sourceGutterY > sourceBottom + 6 &&
    sourceGutterY < sourceRowBottom;
  const sourceLead = useSourceGutter
    ? `M ${round(sourcePortX)} ${round(sourceBottom)} V ${round(sourceGutterY)} H ${round(railX)}`
    : `M ${round(source.x)} ${round(sourceExitY)} H ${round(railX)}`;

  // Return rail crosses the target row along channelY; drop it below the target
  // row's cards when it would otherwise slice through one.
  let channelY = targetRowBottom - 20 - slot.channel * EDGE_CHANNEL_GAP;
  if (horizontalRouteBlocked(channelY, railX, targetPortX, edge, context)) {
    const clearY = rowClearY(target.stageIndex, channelY);
    if (clearY < targetRowBottom) channelY = clearY;
  }
  return {
    path: `${sourceLead} V ${round(channelY)} H ${round(targetPortX)} V ${round(targetBottom + ARROW_CLEARANCE)}`,
    labelX: railX + 70,
    labelY: (sourceCenterY + channelY) / 2,
  };
}

// Minimal stand-in for the source's estimatedTextWidth: a generic
// character-width heuristic (no Korea-specific data, no SVG). Needed by
// buildEdgeLabelLayout to size label boxes.
function estimatedTextWidth(text, fontSize) {
  return textWidthUnits(String(text)) * fontSize;
}

function textWidthUnits(text) {
  return Array.from(text).reduce((sum, char) => {
    if (/\s/u.test(char)) return sum + 0.35;
    if (/[MW@%]/u.test(char)) return sum + 0.9;
    if (/[A-Z]/u.test(char)) return sum + 0.72;
    if (/[a-z0-9]/u.test(char)) return sum + 0.58;
    if (".,:;·/()[]{}+-_!?".includes(char)) return sum + 0.5;
    return sum + 1;
  }, 0);
}

// Stand-in for the source's validateTextLayout. The original checks
// Korea-specific card text (node.name/blocker/actor, institution
// name/oneLiner/canvas.purpose) against renderer-only font constants
// (CARD_TITLE_*, CARD_FOOTER_*, CARD_TEXT_WIDTH) that belong to the SVG
// renderer (Task 6), not this geometry layer — and board nodes here don't
// even have those fields (schema only defines id/lane/stage/label/emphasis/
// note/refs). This keeps buildLayout runnable without the renderer while
// still surfacing the same aggregate counts the source audit returned.
function validateTextLayout(context) {
  return {
    nodes: context.process.nodes.length,
    stages: context.process.stages.length,
    groups: context.groups.length,
    edgeLabels: context.edgeLabelLayout.size,
    adjustedEdgeLabels: Array.from(context.edgeLabelLayout.values()).filter(
      (label) => label.adjusted
    ).length,
    edgeRoutes: context.edgeRouteAudit.routes,
    longEdgeRoutes: context.edgeRouteAudit.longRoutes,
  };
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function alternatingSlotOffset(index) {
  if (index === 0) return 0;
  const magnitude = Math.ceil(index / 2);
  return index % 2 === 1 ? -magnitude : magnitude;
}

function sidePortOffset(port, channel) {
  return port * 13 + channel * 2.5;
}
